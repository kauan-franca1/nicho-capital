"""Etapa `nicho pontuar`: score de relevância e event studies de documentos e histórias."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import psycopg
from psycopg.types.json import Jsonb

from nicho.config import Config
from nicho.enrich.run import ORDEM_MAT, vec_py
from nicho.enrich.stories import novidade
from nicho.runs import RunContext
from nicho.scoring.relevance import EntradaScore, score
from nicho.stats.anomalies import robust_z
from nicho.stats.event_study import event_study
from nicho.stats.returns import log_returns
from nicho.stats.run import load_prices

SP = ZoneInfo("America/Sao_Paulo")
INDICE = "^BVSP"
FECHAMENTO_HORA = 18  # notícia publicada depois das 18h (Brasília) afeta o pregão seguinte


def pregao_do_evento(quando: datetime, pregoes: pd.DatetimeIndex) -> date | None:
    local = quando.astimezone(SP)
    dia = local.date() + timedelta(days=1 if local.hour >= FECHAMENTO_HORA else 0)
    pos = int(pregoes.searchsorted(pd.Timestamp(dia)))
    return None if pos >= len(pregoes) else pregoes[pos].date()


class Reacoes:
    """z robusto do retorno AJUSTADO AO MERCADO (ativo − Ibovespa) e do volume, por pregão.

    Ajustar ao mercado evita atribuir a uma notícia um movimento que foi do mercado inteiro
    (ex.: no crash de 26/10/2026 qualquer notícia de banco pareceria ter "mexido" a ação).
    """

    def __init__(self, conn: psycopg.Connection, janela: int, min_obs: int) -> None:
        self.precos = load_prices(conn)
        self.z_ret: dict[str, pd.Series] = {}
        self.z_vol: dict[str, pd.Series] = {}
        indice = self.precos.get(INDICE)
        r_mercado = log_returns(indice["px"]) if indice is not None else None
        for t, f in self.precos.items():
            r = log_returns(f["px"])
            if r_mercado is not None and t != INDICE:
                r = (r - r_mercado).dropna()
            self.z_ret[t] = robust_z(r, janela, min_obs)["z"]
            v = f["volume"][f["volume"] > 0].astype(float)
            self.z_vol[t] = robust_z(pd.Series(np.log(v), index=v.index), janela, min_obs)["z"]
        self.pregoes = pd.DatetimeIndex(indice.index if indice is not None else [])

    def z(self, ticker: str, dia: date) -> tuple[float | None, float | None]:
        ts = pd.Timestamp(dia)

        def pegar(s: pd.Series | None) -> float | None:
            if s is None or ts not in s.index:
                return None
            v = s.loc[ts]
            return None if pd.isna(v) else float(v)

        return pegar(self.z_ret.get(ticker)), pegar(self.z_vol.get(ticker))


def centralidades_recentes(conn: psycopg.Connection) -> dict[str, float]:
    """Centralidade de autovetor do snapshot de correlação mais recente, normalizada pelo máximo."""
    with conn.cursor() as cur:
        cur.execute(
            "select payload from graph_snapshots where tipo = 'correlacao_mst' "
            "order by referencia desc limit 1"
        )
        row = cur.fetchone()
    if not row:
        return {}
    nos = row[0].get("nos", [])
    maximo = max((float(n.get("autovetor", 0)) for n in nos), default=0.0)
    if maximo <= 0:
        return {}
    return {n["id"]: round(float(n["autovetor"]) / maximo, 4) for n in nos}


def pontuar_historias(
    conn: psycopg.Connection, cfg: Config, run: RunContext, agora: datetime, desde: datetime
) -> None:
    acfg = cfg.stats.anomalias
    reacoes = Reacoes(conn, acfg.janela, acfg.min_obs)
    centralidade = centralidades_recentes(conn)
    with conn.cursor() as cur:
        cur.execute(
            "select id, primeira_em, ultima_em, n_fontes, tickers, tipo_evento, materialidade, "
            "sentimento, centroid::text from stories "
            "where ultima_em >= %s and centroid is not null",
            (desde - timedelta(days=cfg.nlp.novidade.dias_referencia),),
        )
        todas = cur.fetchall()
    vetores = {int(r[0]): vec_py(r[8]) for r in todas}
    linhas = []
    for sid, primeira, ultima, n_fontes, tickers, tipo, mat, sent, _ in todas:
        if ultima < desde:
            continue  # só serve de referência para a novidade
        ref_ini = primeira - timedelta(days=cfg.nlp.novidade.dias_referencia)
        anteriores = [vetores[int(o[0])] for o in todas if ref_ini <= o[1] < primeira]
        nov = novidade(vetores[int(sid)], np.array(anteriores) if anteriores else np.zeros((0,)))

        z_ret = z_vol = None
        dia = pregao_do_evento(primeira, reacoes.pregoes) if len(reacoes.pregoes) else None
        if dia:
            for t in tickers or []:
                zr, zv = reacoes.z(t, dia)
                if zr is not None and (z_ret is None or abs(zr) > abs(z_ret)):
                    z_ret, z_vol = zr, zv

        total, componentes = score(
            EntradaScore(
                materialidade=mat,
                tipo_evento=tipo,
                n_tickers=len(tickers or []),
                sentimento=sent,
                n_fontes=int(n_fontes),
                z_retorno=z_ret,
                z_volume=z_vol,
                centralidade=max(
                    (centralidade[t] for t in tickers or [] if t in centralidade), default=None
                ),
                novidade=nov,
                ultima_em=ultima,
                agora=agora,
            ),
            cfg.scoring,
        )
        if dia:
            componentes["reacao_mercado"]["pregao"] = dia.isoformat()
        linhas.append((int(sid), total, Jsonb(componentes), cfg.scoring.versao))

    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into relevance_scores (story_id, score, componentes, pesos_versao, calculado_em)
            values (%s, %s, %s, %s, now())
            on conflict (story_id) do update set score = excluded.score,
                componentes = excluded.componentes, pesos_versao = excluded.pesos_versao,
                calculado_em = now()
            """,
            linhas,
        )
    conn.commit()
    run.contar("historias_pontuadas", len(linhas))


def estudos_de_eventos(conn: psycopg.Connection, cfg: Config, run: RunContext) -> None:
    """Event study para cada fato relevante e cada história de materialidade alta (prompt §5.5).

    Histórias que já contêm um documento da CVM não geram estudo próprio (seria duplicado).
    """
    es = cfg.stats.event_study
    minimo = ORDEM_MAT[cfg.nlp.event_study.materialidade_minima]
    precos = load_prices(conn)
    indice = cfg.universe.indice.ticker
    if indice not in precos:
        return
    retornos = {t: log_returns(f["px"]) for t, f in precos.items()}
    pregoes = pd.DatetimeIndex(retornos[indice].index)

    with conn.cursor() as cur:
        cur.execute(
            "select id, ticker, data_entrega, coalesce(assunto, categoria) from filings "
            "where categoria = 'Fato Relevante'"
        )
        eventos: list[tuple[str, int, str, datetime, str]] = [
            ("filing", int(i), t, d, f"Fato relevante: {a}") for i, t, d, a in cur.fetchall()
        ]
        cur.execute(
            """
            select s.id, s.tickers, s.primeira_em, s.titulo, s.materialidade from stories s
            where s.materialidade is not null and not exists
                (select 1 from story_items si where si.story_id = s.id and si.filing_id is not null)
            """
        )
        for sid, tickers, primeira, titulo, mat in cur.fetchall():
            if ORDEM_MAT.get(mat, 0) >= minimo:
                for t in tickers or []:
                    eventos.append(("story", int(sid), t, primeira, f"Notícia: {titulo}"))

    linhas: list[tuple[Any, ...]] = []
    pendentes = 0
    for origem, oid, ticker, quando, rotulo in eventos:
        dia = pregao_do_evento(quando, pregoes)
        if dia is None or ticker not in retornos:
            pendentes += len(es.janelas)
            continue
        for janela in es.janelas:
            r = event_study(
                retornos[ticker],
                retornos[indice],
                dia,
                janela,
                es.estimacao,
                es.min_obs_estimacao,
                es.nivel_confianca,
            )
            if r is None:
                pendentes += 1
                continue
            serie = {
                "nivel_confianca": r.nivel_confianca,
                "dias": [
                    [d.rel, d.dia.isoformat(), d.ar, d.car, d.car_ic_inf, d.car_ic_sup]
                    for d in r.dias
                ],
            }
            linhas.append(
                (
                    ticker,
                    r.data_evento,
                    r.janela_txt,
                    origem,
                    oid,
                    r.car,
                    r.t_stat,
                    r.p_valor,
                    r.ic_inf,
                    r.ic_sup,
                    r.n_estimacao,
                    Jsonb(serie),
                    rotulo[:200],
                    r.alpha,
                    r.beta,
                    r.sigma,
                    r.r2,
                )
            )
    with conn.cursor() as cur:
        cur.execute("delete from event_studies where origem_tipo in ('filing', 'story')")
        cur.executemany(
            """
            insert into event_studies (ticker, data_evento, janela, origem_tipo, origem_id, car,
                t_stat, p_valor, ic_inf, ic_sup, n_estimacao, serie, rotulo, alpha, beta, sigma, r2)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict do nothing
            """,
            linhas,
        )
    conn.commit()
    run.contar("event_studies_eventos", len(linhas))
    run.contar("event_studies_eventos_pendentes", pendentes)
