"""Exporta o snapshot de demo (ADR 0002): JSONs compactos em demo/, lidos pelo web sem banco.

Formato (versão 1):
  meta.json                {versao, gerado_em, ultima_atualizacao, ultimo_pregao}
  ativos.json              [{ticker, nome, setor, is_index}]
  precos/<arquivo>.json    {ticker, colunas, linhas}; arquivo = ticker sem "^" (índice: BVSP)
  intraday.json            {intervalo, series: {ticker: [[ts_iso, close, volume], ...]}}
  macro.json               {series: [{codigo, slug, nome, unidade, periodicidade, observacoes}]}
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from nicho.briefing import query_briefings_export

VERSAO = 1
COLUNAS_PRECO = ["dia", "open", "high", "low", "close", "adj_close", "volume", "fonte"]


def arquivo_ticker(ticker: str) -> str:
    return ticker.replace("^", "") + ".json"


def _r(v: Any, casas: int = 4) -> Any:
    if v is None:
        return None
    if isinstance(v, Decimal | float):
        return round(float(v), casas)
    if isinstance(v, datetime | date):
        return v.isoformat()
    return v


def build_snapshot(
    *,
    ativos: Iterable[tuple[str, str, str, bool]],
    precos: Iterable[tuple[Any, ...]],
    intraday: Iterable[tuple[str, datetime, Any, Any]],
    macro_series: Iterable[tuple[int, str, str, str, str]],
    macro_obs: Iterable[tuple[int, date, Any]],
    ultima_atualizacao: datetime | None,
    gerado_em: datetime,
    intervalo_intraday: str = "15m",
) -> dict[str, Any]:
    """Monta {caminho_relativo: payload}. Função pura: recebe linhas já consultadas."""
    files: dict[str, Any] = {}

    lista_ativos = [
        {"ticker": t, "nome": n, "setor": s, "is_index": bool(i)} for t, n, s, i in ativos
    ]
    files["ativos.json"] = lista_ativos

    por_ticker: dict[str, list[list[Any]]] = defaultdict(list)
    for row in precos:
        ticker, *resto = row
        por_ticker[ticker].append([_r(v) for v in resto])
    ultimo_pregao: str | None = None
    for ticker, linhas in sorted(por_ticker.items()):
        linhas.sort(key=lambda linha: linha[0])
        files[f"precos/{arquivo_ticker(ticker)}"] = {
            "ticker": ticker,
            "colunas": COLUNAS_PRECO,
            "linhas": linhas,
        }
        if ticker.startswith("^") and linhas:
            ultimo_pregao = linhas[-1][0]

    series_intra: dict[str, list[list[Any]]] = defaultdict(list)
    for ticker, ts, close, vol in intraday:
        series_intra[ticker].append([_r(ts), _r(close), _r(vol)])
    files["intraday.json"] = {
        "intervalo": intervalo_intraday,
        "series": {t: sorted(v, key=lambda x: x[0]) for t, v in sorted(series_intra.items())},
    }

    obs_por_serie: dict[int, list[list[Any]]] = defaultdict(list)
    for codigo, dia, valor in macro_obs:
        obs_por_serie[codigo].append([_r(dia), _r(valor, 6)])
    files["macro.json"] = {
        "series": [
            {
                "codigo": c,
                "slug": slug,
                "nome": nome,
                "unidade": unidade,
                "periodicidade": per,
                "observacoes": sorted(obs_por_serie.get(c, []), key=lambda x: x[0]),
            }
            for c, slug, nome, unidade, per in macro_series
        ]
    }

    files["meta.json"] = {
        "versao": VERSAO,
        "gerado_em": _r(gerado_em),
        "ultima_atualizacao": _r(ultima_atualizacao),
        "ultimo_pregao": ultimo_pregao,
    }
    return files


def query_snapshot(conn: psycopg.Connection, gerado_em: datetime) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "select ticker, nome, setor, is_index from assets order by is_index desc, ticker"
        )
        ativos = cur.fetchall()
        cur.execute(
            "select ticker, dia, open, high, low, close, adj_close, volume, fonte "
            "from prices_daily order by ticker, dia"
        )
        precos = cur.fetchall()
        cur.execute("select ticker, ts, close, volume from prices_intraday order by ticker, ts")
        intraday = cur.fetchall()
        cur.execute(
            "select codigo_sgs, slug, nome, unidade, periodicidade from macro_series "
            "order by codigo_sgs"
        )
        macro_series = cur.fetchall()
        cur.execute(
            "select codigo_sgs, dia, valor from macro_observations order by codigo_sgs, dia"
        )
        macro_obs = cur.fetchall()
        cur.execute(
            "select max(terminado_em) from pipeline_runs "
            "where etapa = 'precos' and status in ('ok', 'parcial')"
        )
        row = cur.fetchone()
        cur.execute(
            "select ticker, dia, metodo, valor, severidade, detalhes from anomalies "
            "order by ticker, dia, metodo"
        )
        anomalias = cur.fetchall()
        cur.execute(
            "select ticker, distribuicao, mu, omega, alpha, beta, nu, persistencia, meia_vida, "
            "vol_longo_prazo, log_likelihood, n, convergiu, ultimo_dia, previsao, ajustado_em "
            "from garch_fits order by ticker"
        )
        garch = cur.fetchall()
        cur.execute(
            "select ticker, dia, vol_garch, vol_realizada_21 from volatility_daily "
            "order by ticker, dia"
        )
        vol = cur.fetchall()
        cur.execute(
            "select ticker, data_evento, janela, origem_tipo, rotulo, car, t_stat, p_valor, "
            "ic_inf, ic_sup, n_estimacao, alpha, beta, sigma, r2, serie from event_studies "
            "order by ticker, data_evento, janela"
        )
        estudos = cur.fetchall()
    files = build_snapshot(
        ativos=ativos,
        precos=precos,
        intraday=intraday,
        macro_series=macro_series,
        macro_obs=macro_obs,
        ultima_atualizacao=row[0] if row else None,
        gerado_em=gerado_em,
    )
    files.update(build_stats_snapshot(anomalias=anomalias, garch=garch, vol=vol, estudos=estudos))
    files.update(query_noticias(conn))
    files.update(query_grafos(conn))
    files["briefing.json"] = query_briefings_export(conn)
    files["status.json"] = query_status(conn)
    return files


def query_status(conn: psycopg.Connection, limite: int = 60) -> dict[str, Any]:
    """status.json: últimas execuções do pipeline (para /status no modo demo)."""
    with conn.cursor() as cur:
        cur.execute(
            "select etapa, status, iniciado_em, duracao_ms, contagens, erro, gatilho "
            "from pipeline_runs where not (etapa = 'export_demo' and status = 'rodando') "
            "order by iniciado_em desc limit %s",
            (limite,),
        )
        cols = ["etapa", "status", "iniciado_em", "duracao_ms", "contagens", "erro", "gatilho"]
        return {
            "execucoes": [
                {
                    c: (v.isoformat() if isinstance(v, datetime) else v)
                    for c, v in zip(cols, r, strict=True)
                }
                for r in cur.fetchall()
            ]
        }


def query_grafos(conn: psycopg.Connection) -> dict[str, Any]:
    """grafos/correlacao.json (todos os snapshots); conhecimento e choque (os mais recentes)."""
    with conn.cursor() as cur:
        cur.execute(
            "select referencia, payload, metricas from graph_snapshots "
            "where tipo = 'correlacao_mst' order by referencia"
        )
        snaps = [
            {"referencia": _r(ref), "metricas": met, **payload}
            for ref, payload, met in cur.fetchall()
        ]
        out: dict[str, Any] = {"grafos/correlacao.json": {"snapshots": snaps}}
        for tipo in ("conhecimento", "choque"):
            cur.execute(
                "select referencia, payload, metricas from graph_snapshots where tipo = %s "
                "order by referencia desc limit 1",
                (tipo,),
            )
            row = cur.fetchone()
            out[f"grafos/{tipo}.json"] = (
                None if row is None else {"referencia": _r(row[0]), "metricas": row[2], **row[1]}
            )
    return out


def query_noticias(conn: psycopg.Connection, dias: int = 21, limite: int = 800) -> dict[str, Any]:
    """noticias.json (histórias pontuadas com itens e fontes) e nlp.json (qualidade do NLP)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select s.id, s.titulo, s.resumo, s.primeira_em, s.ultima_em, s.tickers, s.fontes,
                   s.n_fontes, s.tipo_evento, s.materialidade, s.sentimento, r.score, r.componentes,
                   s.centroid::text
            from stories s join relevance_scores r on r.story_id = s.id
            where s.ultima_em >= (select max(ultima_em) from stories) - make_interval(days => %s)
            order by r.score desc, s.ultima_em desc
            limit %s
            """,
            (dias, limite),
        )
        historias = cur.fetchall()
        ids = [h[0] for h in historias]
        cur.execute(
            """
            select si.story_id, 'noticia', n.titulo, n.fonte_nome, n.link, n.publicado_em,
                   s.label, e.metodo
            from story_items si join news_items n on n.id = si.news_item_id
            left join sentiment s on s.news_item_id = n.id and s.modelo not like 'llm:%%'
            left join extractions e on e.news_item_id = n.id
            where si.story_id = any(%s)
            union all
            select si.story_id, 'cvm', f.categoria || ': ' || coalesce(f.assunto, ''), 'CVM',
                   f.link_download, f.data_entrega, s.label, e.metodo
            from story_items si join filings f on f.id = si.filing_id
            left join sentiment s on s.filing_id = f.id and s.modelo not like 'llm:%%'
            left join extractions e on e.filing_id = f.id
            where si.story_id = any(%s)
            """,
            (ids, ids),
        )
        itens: dict[int, list[dict[str, Any]]] = defaultdict(list)
        metodos: dict[int, set[str]] = defaultdict(set)
        for sid, tipo, titulo, fonte, link, quando, label, metodo in cur.fetchall():
            itens[sid].append(
                {
                    "tipo": tipo,
                    "titulo": titulo,
                    "fonte": fonte,
                    "link": link,
                    "publicado_em": _r(quando),
                    "sentimento": label,
                }
            )
            if metodo:
                metodos[sid].add(metodo)
        cur.execute(
            "select n, kappa, concordancia, matriz, calculado_em from sentiment_agreement "
            "order by calculado_em desc limit 1"
        )
        acordo = cur.fetchone()
        cur.execute("select valor from nlp_state where chave = 'embedding_media'")
        media = cur.fetchone()
        cur.execute("select metodo, status, count(*) from extractions group by 1, 2 order by 1, 2")
        extracoes = [{"metodo": m, "status": s, "n": n} for m, s, n in cur.fetchall()]

    lista = []
    for linha in historias:
        sid, titulo, resumo, ini, fim, tickers, fontes, n, tipo, mat, sent, sc, comp, vet = linha
        lista.append(
            {
                "id": sid,
                "titulo": titulo,
                "resumo": resumo,
                "primeira_em": _r(ini),
                "ultima_em": _r(fim),
                "tickers": list(tickers or []),
                "fontes": list(fontes or []),
                "n_fontes": n,
                "tipo_evento": tipo,
                "materialidade": mat,
                "sentimento": _r(sent),
                "score": _r(sc, 2),
                "componentes": comp,
                "extracao": "llm" if "llm" in metodos[sid] else "regras" if metodos[sid] else None,
                "itens": sorted(itens[sid], key=lambda i: i["publicado_em"]),
                # Semente centralizada (busca semântica do agente no modo demo).
                "vetor": [round(x, 4) for x in json.loads(vet)] if vet else None,
            }
        )
    nlp = {
        "concordancia": None
        if acordo is None
        else {
            "n": acordo[0],
            "kappa": _r(acordo[1]),
            "concordancia": _r(acordo[2]),
            "matriz": acordo[3],
            "calculado_em": _r(acordo[4]),
        },
        "extracoes": extracoes,
        "embedding_media": media[0] if media else None,
    }
    return {"noticias.json": {"historias": lista}, "nlp.json": nlp}


GARCH_COLS = [
    "distribuicao",
    "mu",
    "omega",
    "alpha",
    "beta",
    "nu",
    "persistencia",
    "meia_vida",
    "vol_longo_prazo",
    "log_likelihood",
    "n",
    "convergiu",
    "ultimo_dia",
    "previsao",
    "ajustado_em",
]
ES_COLS = [
    "data_evento",
    "janela",
    "origem_tipo",
    "rotulo",
    "car",
    "t_stat",
    "p_valor",
    "ic_inf",
    "ic_sup",
    "n_estimacao",
    "alpha",
    "beta",
    "sigma",
    "r2",
]


def build_stats_snapshot(
    *,
    anomalias: Iterable[tuple[Any, ...]],
    garch: Iterable[tuple[Any, ...]],
    vol: Iterable[tuple[Any, ...]],
    estudos: Iterable[tuple[Any, ...]],
    dias_recentes: int = 30,
) -> dict[str, Any]:
    """stats/<ticker>.json por ativo e anomalias.json com as anomalias recentes do universo."""
    por: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"anomalias": [], "garch": None, "volatilidade": [], "event_studies": []}
    )
    todas: list[dict[str, Any]] = []
    for ticker, dia, metodo, valor, sev, detalhes in anomalias:
        a = {
            "dia": _r(dia),
            "metodo": metodo,
            "valor": _r(valor),
            "severidade": sev,
            "detalhes": detalhes,
        }
        por[ticker]["anomalias"].append(a)
        todas.append({"ticker": ticker, **a})
    for ticker, *vals in garch:
        por[ticker]["garch"] = {c: _r(v, 6) for c, v in zip(GARCH_COLS, vals, strict=True)}
    for ticker, dia, vg, vr in vol:
        por[ticker]["volatilidade"].append([_r(dia), _r(vg), _r(vr)])
    for ticker, *vals in estudos:
        *campos, serie = vals
        es = {c: _r(v, 6) for c, v in zip(ES_COLS, campos, strict=True)}
        es["nivel_confianca"] = serie.get("nivel_confianca")
        es["dias"] = [[d[0], d[1], *(_r(x, 6) for x in d[2:])] for d in serie.get("dias", [])]
        por[ticker]["event_studies"].append(es)

    files: dict[str, Any] = {
        f"stats/{arquivo_ticker(t)}": {"ticker": t, **conteudo}
        for t, conteudo in sorted(por.items())
    }
    if todas:
        ultimo = max(a["dia"] for a in todas)
        corte = (date.fromisoformat(ultimo) - timedelta(days=dias_recentes)).isoformat()
        recentes = [a for a in todas if a["dia"] >= corte]
        recentes.sort(key=lambda a: (a["dia"], abs(a["valor"] or 0)), reverse=True)
    else:
        recentes = []
    files["anomalias.json"] = {"dias_recentes": dias_recentes, "anomalias": recentes}
    return files


def write_snapshot(files: dict[str, Any], out_dir: Path) -> int:
    """Substitui os dados de out_dir (preserva o README.md). Devolve o total de bytes."""
    for sub in ("precos", "stats", "grafos"):
        if (out_dir / sub).exists():
            shutil.rmtree(out_dir / sub)
    total = 0
    for rel, payload in sorted(files.items()):
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        path.write_text(text, encoding="utf-8")
        total += len(text.encode("utf-8"))
    return total
