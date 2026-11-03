"""Etapa `nicho grafos`: snapshots de correlação, grafo de conhecimento e rankings de choque."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import httpx
import pandas as pd
import psycopg
from psycopg.types.json import Jsonb

from nicho.config import Config
from nicho.graphs import correlation, knowledge, shock
from nicho.ingest.cvm import BASE, CvmClient
from nicho.runs import RunContext
from nicho.stats.returns import log_returns
from nicho.stats.run import load_prices


def _salvar_snapshot(
    cur: psycopg.Cursor[tuple[object, ...]], tipo: str, ref: date, payload: object, metricas: object
) -> None:
    cur.execute(
        """
        insert into graph_snapshots (tipo, referencia, payload, metricas) values (%s, %s, %s, %s)
        on conflict (tipo, referencia) do update set payload = excluded.payload,
            metricas = excluded.metricas, created_at = now()
        """,
        (tipo, ref, Jsonb(payload), Jsonb(metricas)),
    )


def correlacoes(
    conn: psycopg.Connection, cfg: Config, run: RunContext
) -> list[tuple[str, str, float]]:
    """Grava um snapshot por mês; devolve as correlações (≥ limiar) do snapshot mais recente."""
    c = cfg.graphs.correlacao
    precos = load_prices(conn)
    indice = cfg.universe.indice.ticker
    retornos = pd.DataFrame(
        {t: log_returns(f["px"]) for t, f in precos.items() if t != indice}
    ).sort_index()
    if retornos.empty:
        run.avisar("sem preços: rode `nicho ingest precos` antes")
        return []
    setores = {a.ticker: a.setor for a in cfg.universe.ativos}
    anterior = None
    n = 0
    with conn.cursor() as cur:
        for ref in correlation.datas_snapshot(pd.DatetimeIndex(retornos.index), c.meses):
            s = correlation.snapshot(
                retornos,
                ref,
                c.janela_dias,
                c.min_obs,
                c.rho_minimo,
                c.semente_layout,
                setores,
                anterior,
            )
            if s is None:
                continue
            anterior = {no["id"]: (no["x"], no["y"]) for no in s.nos}
            payload = {"n_obs": s.n_obs, "nos": s.nos, "arestas": s.arestas}
            _salvar_snapshot(cur, "correlacao_mst", ref, payload, s.metricas)
            n += 1
            ultimo = s
    conn.commit()
    run.contar("snapshots_correlacao", n)
    if n == 0:
        return []
    fim = pd.Timestamp(ultimo.referencia)
    janela = retornos.loc[retornos.index > fim - pd.Timedelta(days=c.janela_dias)]
    corr = correlation.matriz_correlacao(janela.dropna(axis=1, thresh=c.min_obs), c.min_obs)
    return correlation.pares(corr, c.rho_minimo)


def baixar_fre(cvm: CvmClient, ano: int) -> bytes:
    try:
        return cvm._bytes(f"{BASE}/FRE/DADOS/fre_cia_aberta_{ano}.zip")
    except httpx.HTTPStatusError:
        return cvm._bytes(f"{BASE}/FRE/DADOS/fre_cia_aberta_{ano - 1}.zip")


def conhecimento_e_choque(
    conn: psycopg.Connection,
    cfg: Config,
    run: RunContext,
    corr: list[tuple[str, str, float]],
    fre_zip: bytes,
    agora: datetime,
) -> None:
    with conn.cursor() as cur:
        cur.execute("select cnpj, ticker from assets where cnpj is not null and not is_index")
        cnpj_ticker: dict[str, str] = {}
        for cnpj, t in cur.fetchall():
            cnpj_ticker.setdefault(cnpj, t)  # PETR4 e PETR3: fica o primeiro
        cur.execute(
            """
            select s.id, s.titulo, s.tickers, r.score, s.ultima_em
            from stories s join relevance_scores r on r.story_id = s.id
            where s.ultima_em >= %s and cardinality(s.tickers) > 0
            """,
            (agora - timedelta(days=21),),
        )
        historias = [
            knowledge.HistoriaRef(int(i), t, tuple(tk), float(sc), u)
            for i, t, tk, sc, u in cur.fetchall()
        ]
    if not cnpj_ticker:
        run.avisar("assets sem CNPJ: rode `nicho ingest noticias` (etapa CVM) antes")
    admins, acionistas = knowledge.ler_fre(fre_zip, set(cnpj_ticker))
    k = knowledge.construir(
        cfg.universe, cnpj_ticker, admins, acionistas, historias, cfg.graphs.conhecimento, agora
    )
    pos = knowledge.layout(k, cfg.graphs.correlacao.semente_layout)
    hoje = agora.date()

    with conn.cursor() as cur:
        cur.execute("delete from kg_edges")
        cur.execute("delete from kg_nodes")
        cur.executemany(
            "insert into kg_nodes (id, tipo, rotulo, atributos) values (%s, %s, %s, %s)",
            [
                (
                    n,
                    d["tipo"],
                    d["rotulo"],
                    Jsonb({kk: v for kk, v in d.items() if kk not in ("tipo", "rotulo")}),
                )
                for n, d in k.g.nodes(data=True)
            ],
        )
        cur.executemany(
            "insert into kg_edges (origem, destino, relacao, peso, fonte) values (%s,%s,%s,%s,%s) "
            "on conflict do nothing",
            [
                (
                    a,
                    b,
                    d["relacao"],
                    d.get("peso", 1.0),
                    "cvm_fre"
                    if d["relacao"] in ("ADMINISTRA", "CONTROLA", "PARTICIPA")
                    else "nicho",
                )
                for a, b, d in k.g.edges(data=True)
            ],
        )
        tipos: dict[str, int] = {}
        for _, d in k.g.nodes(data=True):
            tipos[d["tipo"]] = tipos.get(d["tipo"], 0) + 1
        _salvar_snapshot(
            cur, "conhecimento", hoje, knowledge.exportar(k, pos), {"nos_por_tipo": tipos}
        )

        g = shock.grafo_propagacao(k.g, corr, cfg.graphs.choque)
        resultados = {s: shock.propagar(g, s, cfg.graphs.choque) for s in shock.sementes(g)}
        resultados = {s: r for s, r in resultados.items() if r}
        _salvar_snapshot(
            cur, "choque", hoje, shock.exportar(g, resultados), {"sementes": len(resultados)}
        )
    conn.commit()
    for tipo, n in sorted(tipos.items()):
        run.contar(f"nos_{tipo.lower()}", n)
    run.contar("arestas_conhecimento", k.g.number_of_edges())
    run.contar("sementes_choque", len(resultados))


def rodar(conn: psycopg.Connection, cfg: Config, run: RunContext, cvm: CvmClient) -> None:
    agora = datetime.now(UTC)
    corr = correlacoes(conn, cfg, run)
    conhecimento_e_choque(conn, cfg, run, corr, baixar_fre(cvm, agora.year), agora)
