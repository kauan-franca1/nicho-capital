"""Ingestão de cotações: diário (3 anos) com fallback e intraday recente (prompt §5.1)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta

import psycopg

from nicho.config import Universe
from nicho.providers.quotes import (
    Bar,
    IntradayBar,
    QuoteProvider,
    YFinanceProvider,
    fetch_daily_with_fallback,
)
from nicho.runs import RunContext

INTRADAY_INTERVALO = "15m"
INTRADAY_RETENCAO_DIAS = 7

UPSERT_DAILY = """
insert into prices_daily (ticker, dia, open, high, low, close, adj_close, volume, fonte)
values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
on conflict (ticker, dia) do update set
    open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
    adj_close = excluded.adj_close, volume = excluded.volume, fonte = excluded.fonte,
    ingested_at = now()
"""

UPSERT_INTRADAY = """
insert into prices_intraday (ticker, ts, intervalo, close, volume, fonte)
values (%s, %s, %s, %s, %s, %s)
on conflict (ticker, intervalo, ts) do update set
    close = excluded.close, volume = excluded.volume, fonte = excluded.fonte
"""


def tickers_do_universo(universe: Universe) -> list[str]:
    return [universe.indice.ticker, *(a.ticker for a in universe.ativos)]


def ingest_daily(
    conn: psycopg.Connection,
    universe: Universe,
    providers: Sequence[QuoteProvider],
    run: RunContext,
    anos: int = 3,
    hoje: date | None = None,
) -> None:
    start = (hoje or date.today()) - timedelta(days=round(365.25 * anos))
    result = fetch_daily_with_fallback(providers, tickers_do_universo(universe), start)
    for t in result.sem_dados:
        run.avisar(f"sem cotação diária para {t} em nenhum provedor")
    rows = [
        _daily_row(t, b, result.fonte[t]) for t, bars in sorted(result.bars.items()) for b in bars
    ]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_DAILY, rows)
    conn.commit()
    run.contar("barras_diarias", len(rows))
    run.contar("tickers_com_dados", len(result.bars))
    for fonte in sorted(set(result.fonte.values())):
        run.contar(f"fonte_{fonte}", sum(1 for f in result.fonte.values() if f == fonte))


def _daily_row(t: str, b: Bar, fonte: str) -> tuple[object, ...]:
    return (t, b.dia, b.open, b.high, b.low, b.close, b.adj_close, b.volume, fonte)


def ingest_intraday(
    conn: psycopg.Connection,
    universe: Universe,
    provider: YFinanceProvider,
    run: RunContext,
) -> None:
    """Intraday é "quando disponível": falha aqui vira aviso, nunca derruba a etapa."""
    try:
        data = provider.intraday(tickers_do_universo(universe), interval=INTRADAY_INTERVALO)
    except Exception as exc:
        run.avisar(f"intraday indisponível: {exc!r}")
        return
    rows = [_intraday_row(t, b, provider.name) for t, bars in sorted(data.items()) for b in bars]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_INTRADAY, rows)
        cur.execute(
            "delete from prices_intraday where ts < now() - make_interval(days => %s)",
            (INTRADAY_RETENCAO_DIAS,),
        )
    conn.commit()
    run.contar("barras_intraday", len(rows))


def _intraday_row(t: str, b: IntradayBar, fonte: str) -> tuple[object, ...]:
    return (t, b.ts, INTRADAY_INTERVALO, b.close, b.volume, fonte)
