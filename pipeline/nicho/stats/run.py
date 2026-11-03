"""Etapa `nicho stats`: anomalias, GARCH e event studies de choques de mercado.

Idempotente: para cada ativo, os resultados anteriores são substituídos dentro de uma transação.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd
import psycopg
from psycopg.types.json import Jsonb

from nicho.config import Severidade, Stats, Universe
from nicho.runs import RunContext
from nicho.stats.anomalies import (
    Anomalia,
    change_point_anomalies,
    return_anomalies,
    volume_anomalies,
)
from nicho.stats.event_study import EventStudyResult, event_study
from nicho.stats.garch import fit_garch
from nicho.stats.returns import log_returns, realized_vol

ORDEM_SEV: dict[Severidade, int] = {"baixa": 1, "media": 2, "alta": 3}


def load_prices(conn: psycopg.Connection) -> dict[str, pd.DataFrame]:
    """{ticker: DataFrame[px, volume]} com px = preço ajustado (ou fechamento)."""
    with conn.cursor() as cur:
        cur.execute(
            "select ticker, dia, coalesce(adj_close, close)::float8, volume::float8 "
            "from prices_daily order by ticker, dia"
        )
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["ticker", "dia", "px", "volume"])
    df["dia"] = pd.to_datetime(df["dia"])
    return {
        str(t): g.set_index("dia")[["px", "volume"]] for t, g in df.groupby("ticker", sort=True)
    }


def compute_anomalies(ticker: str, frame: pd.DataFrame, cfg: Stats) -> list[Anomalia]:
    r = log_returns(frame["px"])
    out = return_anomalies(ticker, r, cfg.anomalias)
    if not ticker.startswith("^"):  # o volume do índice no Yahoo não é confiável
        out += volume_anomalies(ticker, frame["volume"].dropna(), cfg.anomalias)
    out += change_point_anomalies(ticker, r, cfg.change_points)
    return out


def market_shocks(index_anomalies: list[Anomalia], minimo: Severidade) -> list[Anomalia]:
    return [
        a
        for a in index_anomalies
        if a.metodo == "robust_z_retorno" and ORDEM_SEV[a.severidade] >= ORDEM_SEV[minimo]
    ]


def rotulo_choque(a: Anomalia) -> str:
    ret = float(a.detalhes.get("retorno", 0.0)) * 100
    sinal = "+" if ret >= 0 else "−"
    num = f"{abs(ret):.1f}".replace(".", ",")
    return f"Choque de mercado em {a.dia:%d/%m/%Y} (Ibovespa {sinal}{num}%)"


def _es_row(ticker: str, es: EventStudyResult, rotulo: str) -> tuple[Any, ...]:
    serie = {
        "nivel_confianca": es.nivel_confianca,
        "dias": [
            [d.rel, d.dia.isoformat(), d.ar, d.car, d.car_ic_inf, d.car_ic_sup] for d in es.dias
        ],
    }
    return (
        ticker,
        es.data_evento,
        es.janela_txt,
        "mercado",
        None,
        es.car,
        es.t_stat,
        es.p_valor,
        es.ic_inf,
        es.ic_sup,
        es.n_estimacao,
        Jsonb(serie),
        rotulo,
        es.alpha,
        es.beta,
        es.sigma,
        es.r2,
    )


def run_stats(conn: psycopg.Connection, universe: Universe, cfg: Stats, run: RunContext) -> None:
    precos = load_prices(conn)
    indice = universe.indice.ticker
    if indice not in precos:
        run.avisar("sem preços do índice: rode `nicho ingest precos` antes")
        return
    retornos = {t: log_returns(f["px"]) for t, f in precos.items()}

    with conn.cursor() as cur:
        # ---------------------------------------------------------- anomalias
        por_ticker: dict[str, list[Anomalia]] = {}
        for t, frame in precos.items():
            por_ticker[t] = compute_anomalies(t, frame, cfg)
        cur.execute("delete from anomalies")
        cur.executemany(
            "insert into anomalies (ticker, dia, metodo, valor, severidade, detalhes) "
            "values (%s, %s, %s, %s, %s, %s)",
            [
                (a.ticker, a.dia, a.metodo, a.valor, a.severidade, Jsonb(a.detalhes))
                for lista in por_ticker.values()
                for a in lista
            ],
        )
        run.contar("anomalias", sum(len(v) for v in por_ticker.values()))

        # ---------------------------------------------------------- GARCH
        for t, r in retornos.items():
            try:
                fit = fit_garch(r, cfg.garch)
            except Exception as exc:
                run.avisar(f"GARCH falhou em {t}: {exc!r}")
                continue
            if fit is None:
                continue
            if not fit.convergiu:
                run.avisar(f"GARCH sem convergência em {t}")
            cur.execute(
                """
                insert into garch_fits (ticker, distribuicao, mu, omega, alpha, beta, nu,
                    persistencia, meia_vida, vol_longo_prazo, log_likelihood, n, convergiu,
                    ultimo_dia, previsao, ajustado_em)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                on conflict (ticker) do update set distribuicao = excluded.distribuicao,
                    mu = excluded.mu, omega = excluded.omega, alpha = excluded.alpha,
                    beta = excluded.beta, nu = excluded.nu, persistencia = excluded.persistencia,
                    meia_vida = excluded.meia_vida, vol_longo_prazo = excluded.vol_longo_prazo,
                    log_likelihood = excluded.log_likelihood, n = excluded.n,
                    convergiu = excluded.convergiu, ultimo_dia = excluded.ultimo_dia,
                    previsao = excluded.previsao, ajustado_em = now()
                """,
                (
                    t,
                    cfg.garch.distribuicao,
                    fit.mu,
                    fit.omega,
                    fit.alpha,
                    fit.beta,
                    fit.nu,
                    fit.persistencia,
                    fit.meia_vida,
                    fit.vol_longo_prazo,
                    fit.log_likelihood,
                    fit.n,
                    fit.convergiu,
                    fit.vol_condicional.index[-1].date(),
                    Jsonb(fit.previsao),
                ),
            )
            realizada = realized_vol(r, 21).reindex(fit.vol_condicional.index)
            cur.execute("delete from volatility_daily where ticker = %s", (t,))
            cur.executemany(
                "insert into volatility_daily (ticker, dia, vol_garch, vol_realizada_21) "
                "values (%s, %s, %s, %s)",
                [
                    (t, dia.date(), float(g), None if math.isnan(v) else float(v))
                    for dia, g, v in zip(
                        fit.vol_condicional.index,
                        fit.vol_condicional.to_numpy(),
                        realizada.to_numpy(),
                        strict=True,
                    )
                ],
            )
            run.contar("garch_ajustados")

        # ---------------------------------------------------------- event studies
        es_cfg = cfg.event_study
        choques = market_shocks(por_ticker.get(indice, []), es_cfg.choque_mercado_severidade)
        linhas: list[tuple[Any, ...]] = []
        pendentes = 0
        for choque in choques:
            rotulo = rotulo_choque(choque)
            for t, r in retornos.items():
                if t == indice:
                    continue
                for janela in es_cfg.janelas:
                    es = event_study(
                        r,
                        retornos[indice],
                        choque.dia,
                        janela,
                        es_cfg.estimacao,
                        es_cfg.min_obs_estimacao,
                        es_cfg.nivel_confianca,
                    )
                    if es is None:
                        pendentes += 1
                    else:
                        linhas.append(_es_row(t, es, rotulo))
        cur.execute("delete from event_studies where origem_tipo = 'mercado'")
        cur.executemany(
            """
            insert into event_studies (ticker, data_evento, janela, origem_tipo, origem_id, car,
                t_stat, p_valor, ic_inf, ic_sup, n_estimacao, serie, rotulo, alpha, beta,
                sigma, r2)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            linhas,
        )
        run.contar("choques_de_mercado", len(choques))
        run.contar("event_studies", len(linhas))
        run.contar("event_studies_pendentes", pendentes)
    conn.commit()
