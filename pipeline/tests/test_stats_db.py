"""Etapa `stats` ponta a ponta num schema temporário, com um choque de mercado sintético."""

from datetime import date

import numpy as np
import pandas as pd
import psycopg
import pytest

from nicho import db
from nicho.config import Ativo, Indice, Universe, load_config
from nicho.runs import MemoryRecorder, track_run
from nicho.stats.run import run_stats

pytestmark = pytest.mark.db

UNIVERSO = Universe(
    versao=1,
    indice=Indice(ticker="^BVSP", nome="Ibovespa"),
    ativos=[
        Ativo(ticker="AAAA3", nome="Sensível", setor="s", apelidos=["A"]),
        Ativo(ticker="BBBB3", nome="Defensiva", setor="s", apelidos=["B"]),
    ],
    setores={"s": "Setor"},
)


def _precos(conn: psycopg.Connection) -> date:
    """600 pregões; no dia 500 o índice cai 12%, AAAA3 cai 12%·1,2 + 8% extra, BBBB3 só o beta."""
    rng = np.random.default_rng(42)
    idx = pd.bdate_range("2024-01-01", periods=600)
    m = rng.normal(0.0003, 0.01, 600)
    m[500] = -0.12
    a = 1.2 * m + rng.normal(0, 0.008, 600)
    a[500] -= 0.08
    b = 0.6 * m + rng.normal(0, 0.006, 600)
    rows = []
    for ticker, r in (("^BVSP", m), ("AAAA3", a), ("BBBB3", b)):
        px = 100 * np.exp(np.cumsum(r))
        vol = np.exp(rng.normal(15, 0.2, 600))
        rows += [
            (ticker, d.date(), float(p), float(p), int(v), "teste")
            for d, p, v in zip(idx, px, vol, strict=True)
        ]
    db.upsert_assets(conn, UNIVERSO)
    with conn.cursor() as cur:
        cur.executemany(
            "insert into prices_daily (ticker, dia, close, adj_close, volume, fonte) "
            "values (%s, %s, %s, %s, %s, %s)",
            rows,
        )
    conn.commit()
    return idx[500].date()


def _rodar(conn: psycopg.Connection) -> dict[str, int]:
    rec = MemoryRecorder()
    with track_run(rec, "stats") as run:
        run_stats(conn, UNIVERSO, load_config().stats, run)
    return run.contagens


def test_stats_ponta_a_ponta_e_idempotente(pg_isolado: psycopg.Connection) -> None:
    conn = pg_isolado
    dia_choque = _precos(conn)

    primeira = _rodar(conn)
    segunda = _rodar(conn)
    assert primeira == segunda  # idempotente: substitui, não duplica
    assert primeira["garch_ajustados"] == 3
    assert primeira["choques_de_mercado"] >= 1

    with conn.cursor() as cur:
        cur.execute("select count(*) from anomalies")
        assert cur.fetchone()[0] == primeira["anomalias"]  # type: ignore[index]

        cur.execute(
            "select severidade from anomalies where ticker = '^BVSP' and dia = %s "
            "and metodo = 'robust_z_retorno'",
            (dia_choque,),
        )
        assert cur.fetchone() == ("alta",)

        cur.execute(
            "select ticker, car, p_valor, beta from event_studies "
            "where data_evento = %s and janela = '[-1,+1]' order by ticker",
            (dia_choque,),
        )
        (ta, car_a, p_a, beta_a), (tb, car_b, p_b, _) = cur.fetchall()
    # AAAA3: reação além do mercado de −8% (significativa); BBBB3: só o beta (não significativa)
    assert ta == "AAAA3" and car_a == pytest.approx(-0.08, abs=0.03) and p_a < 0.01
    assert beta_a == pytest.approx(1.2, abs=0.15)
    assert tb == "BBBB3" and p_b > 0.01
    assert abs(car_b) < 0.03

    with conn.cursor() as cur:
        cur.execute("select count(*) from volatility_daily where ticker = 'AAAA3'")
        assert cur.fetchone()[0] == 599  # type: ignore[index]
