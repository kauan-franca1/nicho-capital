"""Etapa `nicho enriquecer`: embeddings, histórias, sentimento, extração e agregação."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from nicho.config import Config
from nicho.enrich.agreement import kappa_cohen
from nicho.enrich.models import Encoder, SentimentModel, Sentimento
from nicho.enrich.stories import Historia, ItemVetor, agrupar, centralizar
from nicho.extract.run import Extrator
from nicho.ingest.news import MatcherTickers
from nicho.runs import RunContext

ORDEM_MAT = {"baixa": 1, "media": 2, "alta": 3}
# Teto de itens por execução. O limite de cota (nlp.extracao.max_itens_por_execucao) vale só para
# chamadas ao LLM; o restante usa o cache ou as regras, que não custam nada.
MAX_ITENS_TOTAL = 5000


def vec_sql(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v.tolist()) + "]"


def vec_py(s: str) -> np.ndarray:
    return np.asarray(json.loads(s), dtype=np.float32)


# ------------------------------------------------------------------ tickers
def remarcar_tickers(
    conn: psycopg.Connection, matcher: MatcherTickers, run: RunContext, desde: datetime
) -> None:
    """Recalcula os tickers citados com os apelidos atuais de universe.yaml (idempotente)."""
    with conn.cursor() as cur:
        cur.execute(
            "select id, titulo, resumo, tickers from news_items where publicado_em >= %s", (desde,)
        )
        mudancas = [
            (list(novos), i)
            for i, titulo, resumo, antigos in cur.fetchall()
            if sorted(novos := matcher.tickers(titulo, resumo)) != sorted(antigos or [])
        ]
        cur.executemany("update news_items set tickers = %s where id = %s", mudancas)
    conn.commit()
    run.contar("tickers_remarcados", len(mudancas))


# ------------------------------------------------------------------ embeddings
def gerar_embeddings(
    conn: psycopg.Connection, encoder: Encoder, run: RunContext, desde: datetime
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "select id, titulo, coalesce(resumo, '') from news_items "
            "where embedding is null and publicado_em >= %s",
            (desde,),
        )
        news = cur.fetchall()
        cur.execute(
            "select id, coalesce(assunto, categoria), coalesce(left(texto, 1500), '') from filings "
            "where embedding is null and texto_status in ('ok', 'falhou') and data_entrega >= %s",
            (desde,),
        )
        docs = cur.fetchall()
    for tabela, linhas in (("news_items", news), ("filings", docs)):
        if not linhas:
            continue
        vetores = encoder.encode_passages([f"{t}. {r}".strip(". ") for _, t, r in linhas])
        with conn.cursor() as cur:
            cur.executemany(
                f"update {tabela} set embedding = %s::vector where id = %s",
                [(vec_sql(v), i) for (i, _, _), v in zip(linhas, vetores, strict=True)],
            )
        conn.commit()
        run.contar(f"embeddings_{tabela}", len(linhas))


# ------------------------------------------------------------------ histórias
MIN_ITENS_MEDIA = 200


def vetor_medio(conn: psycopg.Connection) -> np.ndarray | None:
    """Vetor médio dos embeddings, calculado uma vez e guardado (nlp_state) para ficar estável."""
    with conn.cursor() as cur:
        cur.execute("select valor from nlp_state where chave = 'embedding_media'")
        row = cur.fetchone()
        if row:
            return np.asarray(row[0], dtype=np.float32)
        cur.execute(
            "select avg(embedding)::text, count(*) from news_items where embedding is not null"
        )
        media, n = cur.fetchone() or (None, 0)
        if media is None or n < MIN_ITENS_MEDIA:
            return None  # pouco dado: agrupa sem centralizar até ter amostra
        v = vec_py(media)
        cur.execute(
            "insert into nlp_state (chave, valor) values ('embedding_media', %s)",
            (Jsonb([round(float(x), 6) for x in v]),),
        )
    conn.commit()
    return v


def agrupar_historias(
    conn: psycopg.Connection, cfg: Config, run: RunContext, desde: datetime
) -> None:
    d = cfg.nlp.dedupe
    with conn.cursor() as cur:
        cur.execute(
            """
            select 'n:' || n.id, n.embedding::text, n.fonte_id, n.publicado_em, n.tickers
            from news_items n left join story_items si on si.news_item_id = n.id
            where si.story_id is null and n.embedding is not null and n.publicado_em >= %s
            union all
            select 'f:' || f.id, f.embedding::text, 'cvm', f.data_entrega, array[f.ticker]
            from filings f left join story_items si on si.filing_id = f.id
            where si.story_id is null and f.embedding is not null and f.data_entrega >= %s
            """,
            (desde, desde),
        )
        soltos = cur.fetchall()
        if not soltos:
            return
        inicio = min(r[3] for r in soltos) - timedelta(hours=d.janela_horas)
        cur.execute(
            "select id, centroid::text, primeira_em, ultima_em, fontes, n_fontes, tickers "
            "from stories "
            "where ultima_em >= %s and centroid is not null",
            (inicio,),
        )
        linhas_hist = cur.fetchall()
    media = vetor_medio(conn)

    def prep(texto_vetor: str) -> np.ndarray:
        v = vec_py(texto_vetor)
        return centralizar(v, media)[0] if media is not None else v

    existentes = [
        # stories.centroid já guarda a semente centralizada: não centraliza de novo.
        Historia(
            int(i), vec_py(c), p, u, set(f), [], n_vetores=max(int(n), 1), tickers=set(t or [])
        )
        for i, c, p, u, f, n, t in linhas_hist
    ]

    chaves: dict[int, str] = {}
    itens = []
    for k, (chave, emb, fonte, quando, tks) in enumerate(soltos):
        chaves[k] = chave
        itens.append(ItemVetor(k, prep(emb), fonte, quando, frozenset(t for t in tks or [] if t)))
    tocadas = agrupar(
        itens, existentes, d.limiar_cosseno, timedelta(hours=d.janela_horas), d.limiar_mesma_empresa
    )

    novas = 0
    with conn.cursor() as cur:
        for h in tocadas:
            if h.id is None:
                cur.execute(
                    "insert into stories (titulo, primeira_em, ultima_em, n_fontes, centroid) "
                    "values ('', %s, %s, %s, %s::vector) returning id",
                    (h.primeira_em, h.ultima_em, len(h.fontes), vec_sql(h.centroide)),
                )
                row = cur.fetchone()
                assert row is not None
                h.id = int(row[0])
                novas += 1
            else:
                cur.execute(
                    "update stories set primeira_em = %s, ultima_em = %s, centroid = %s::vector, "
                    "updated_at = now() where id = %s",
                    (h.primeira_em, h.ultima_em, vec_sql(h.centroide), h.id),
                )
            for k, sim in h.novos:
                tipo, num = chaves[k].split(":")
                coluna = "news_item_id" if tipo == "n" else "filing_id"
                cur.execute(
                    f"insert into story_items (story_id, {coluna}, similaridade) "
                    "values (%s, %s, %s) on conflict do nothing",
                    (h.id, int(num), round(sim, 4)),
                )
    conn.commit()
    run.contar("historias_novas", novas)
    run.contar("itens_agrupados", len(itens))


# ------------------------------------------------------------------ sentimento
def classificar_sentimento(
    conn: psycopg.Connection, modelo: SentimentModel, run: RunContext, desde: datetime
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select 'n', n.id, n.titulo || '. ' || coalesce(n.resumo, '') from news_items n
            where n.publicado_em >= %s and not exists
                (select 1 from sentiment s where s.news_item_id = n.id and s.modelo = %s)
            union all
            select 'f', f.id, coalesce(f.assunto, '') || '. ' || coalesce(left(f.texto, 800), '')
            from filings f
            where f.data_entrega >= %s and f.texto_status in ('ok', 'falhou') and not exists
                (select 1 from sentiment s where s.filing_id = f.id and s.modelo = %s)
            """,
            (desde, modelo.nome, desde, modelo.nome),
        )
        linhas = cur.fetchall()
    if not linhas:
        return
    resultados = modelo.classificar([t for _, _, t in linhas])
    with conn.cursor() as cur:
        for (tipo, i, _), s in zip(linhas, resultados, strict=True):
            _gravar_sentimento(cur, tipo, int(i), modelo.nome, s.label, s.score, s.probabilidades)
    conn.commit()
    run.contar("sentimentos_finbert", len(linhas))


def _gravar_sentimento(
    cur: psycopg.Cursor[Any],
    tipo: str,
    item_id: int,
    modelo: str,
    label: str,
    score: float,
    probs: dict[str, float] | None,
) -> None:
    coluna = "news_item_id" if tipo == "n" else "filing_id"
    cur.execute(
        f"insert into sentiment ({coluna}, modelo, label, score, probabilidades) "
        "values (%s, %s, %s, %s, %s) on conflict do nothing",
        (item_id, modelo, label, score, Jsonb(probs) if probs else None),
    )


# ------------------------------------------------------------------ extração
def extrair(
    conn: psycopg.Connection,
    cfg: Config,
    extrator: Extrator,
    modelo_sentimento: str,
    run: RunContext,
    desde: datetime,
) -> None:
    ecfg = cfg.nlp.extracao
    with conn.cursor() as cur:
        # Documentos da CVM primeiro (fonte primária), depois notícias com empresa do universo.
        cur.execute(
            """
            select * from (
                select 'f' as tipo, f.id, coalesce(f.categoria || ' — ' || f.assunto, f.categoria),
                       left(f.texto, %s), array[f.ticker], f.data_entrega as quando, 0 as prio
                from filings f
                where f.data_entrega >= %s and f.texto_status in ('ok', 'falhou') and not exists
                    (select 1 from extractions e where e.filing_id = f.id and e.prompt_versao = %s)
                union all
                select 'n', n.id, n.titulo, n.resumo, n.tickers, n.publicado_em, 1
                from news_items n
                where n.publicado_em >= %s and cardinality(n.tickers) > 0 and not exists
                    (select 1 from extractions e where e.news_item_id = n.id
                        and e.prompt_versao = %s)
            ) t order by prio, quando desc limit %s
            """,
            (
                ecfg.max_caracteres_entrada,
                desde,
                ecfg.prompt_versao,
                desde,
                ecfg.prompt_versao,
                MAX_ITENS_TOTAL,
            ),
        )
        pendentes = cur.fetchall()
        cur.execute(
            "select coalesce(news_item_id, -1), coalesce(filing_id, -1), label, score "
            "from sentiment where modelo = %s",
            (modelo_sentimento,),
        )
        finbert = {}
        for n_id, f_id, label, sc in cur.fetchall():
            finbert[("n", n_id) if n_id != -1 else ("f", f_id)] = Sentimento(label, sc, {})

    contagem: Counter[str] = Counter()
    for tipo, i, titulo, corpo, tickers, _, _ in pendentes:
        r = extrator.extrair(titulo, corpo, list(tickers or []), finbert.get((tipo, i)))
        contagem[f"{r.metodo}_{r.status}"] += 1
        coluna = "news_item_id" if tipo == "n" else "filing_id"
        with conn.cursor() as cur:
            cur.execute(
                f"insert into extractions ({coluna}, prompt_versao, status, payload, provedor, "
                "modelo, metodo) values (%s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
                (
                    i,
                    ecfg.prompt_versao,
                    r.status,
                    Jsonb(r.extracao.model_dump(mode="json")) if r.extracao else None,
                    r.provedor,
                    r.modelo,
                    r.metodo,
                ),
            )
            if r.extracao and r.metodo == "llm":
                s = r.extracao.sentimento
                _gravar_sentimento(cur, tipo, int(i), f"llm:{r.provedor}", s.label, s.score, None)
        conn.commit()
    for k, v in sorted(contagem.items()):
        run.contar(f"extracao_{k}", v)
    if extrator.cadeia.fora:
        motivos = "; ".join(f"{p}: {m}" for p, m in extrator.cadeia.fora.items())
        run.avisar(f"LLM indisponível ({motivos}); extração por regras como fallback")


# ------------------------------------------------------------------ agregação
@dataclass
class _Item:
    tipo: str
    id: int
    titulo: str
    fonte: str
    quando: datetime
    tickers: list[str]
    sentimento: float | None
    extracao: dict[str, Any] | None
    metodo: str | None


def agregar_historias(
    conn: psycopg.Connection, modelo_sentimento: str, run: RunContext, desde: datetime
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select si.story_id, 'n', n.id, n.titulo, n.fonte_nome, n.publicado_em, n.tickers,
                   s.score, e.payload, e.metodo
            from story_items si join news_items n on n.id = si.news_item_id
            left join sentiment s on s.news_item_id = n.id and s.modelo = %s
            left join extractions e on e.news_item_id = n.id and e.status <> 'extraction_failed'
            join stories st on st.id = si.story_id
            where st.ultima_em >= %s
            union all
            select si.story_id, 'f', f.id,
                   f.categoria || ': ' || coalesce(f.assunto, ''), 'CVM', f.data_entrega,
                   array[f.ticker], s.score, e.payload, e.metodo
            from story_items si join filings f on f.id = si.filing_id
            left join sentiment s on s.filing_id = f.id and s.modelo = %s
            left join extractions e on e.filing_id = f.id and e.status <> 'extraction_failed'
            join stories st on st.id = si.story_id
            where st.ultima_em >= %s
            """,
            (modelo_sentimento, desde, modelo_sentimento, desde),
        )
        por_historia: dict[int, list[_Item]] = defaultdict(list)
        for sid, tipo, i, titulo, fonte, quando, tickers, sc, payload, metodo in cur.fetchall():
            por_historia[int(sid)].append(
                _Item(tipo, int(i), titulo, fonte, quando, list(tickers or []), sc, payload, metodo)
            )

        for sid, itens in por_historia.items():
            cur.execute(
                """
                update stories set titulo = %s, tickers = %s, fontes = %s, n_fontes = %s,
                    tipo_evento = %s, materialidade = %s, sentimento = %s, resumo = %s,
                    updated_at = now()
                where id = %s
                """,
                (*resumir(itens), sid),
            )
    conn.commit()
    run.contar("historias_agregadas", len(por_historia))


def resumir(itens: list[_Item]) -> tuple[Any, ...]:
    """Campos consolidados da história: título, tickers, fontes, tipo, materialidade etc."""
    ordenados = sorted(itens, key=lambda x: x.quando)
    docs = [i for i in ordenados if i.tipo == "f"]
    principal = docs[0] if docs else ordenados[0]
    extracoes = [i for i in itens if i.extracao]
    # Melhor extração: LLM antes de regras, documento antes de notícia, maior confiança.
    melhor = max(
        extracoes,
        key=lambda i: (i.metodo == "llm", i.tipo == "f", float(i.extracao["confianca"])),  # type: ignore[index]
        default=None,
    )
    tickers = sorted(
        {t for i in itens for t in i.tickers}
        | {t for i in extracoes for t in (i.extracao or {}).get("tickers", [])}
    )
    fontes = sorted({i.fonte for i in itens})
    mats = [str((i.extracao or {}).get("materialidade_estimada")) for i in extracoes]
    materialidade = max(mats, key=lambda m: ORDEM_MAT.get(m, 0)) if mats else None
    sents = [i.sentimento for i in itens if i.sentimento is not None]
    sentimento = round(float(np.mean(sents)), 4) if sents else None
    ext = melhor.extracao if melhor else None
    return (
        principal.titulo,
        tickers,
        fontes,
        len(fontes),
        ext.get("tipo_evento") if ext else None,
        materialidade if materialidade in ORDEM_MAT else None,
        sentimento,
        ext.get("resumo_1_linha") if ext and melhor and melhor.metodo == "llm" else None,
    )


# ------------------------------------------------------------------ concordância
def calcular_concordancia(
    conn: psycopg.Connection, modelo_sentimento: str, run: RunContext
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.label, b.label from sentiment a
            join sentiment b on a.modelo = %s and b.modelo like 'llm:%%'
                and ((a.news_item_id = b.news_item_id) or (a.filing_id = b.filing_id))
            """,
            (modelo_sentimento,),
        )
        pares = cur.fetchall()
        if not pares:
            return
        c = kappa_cohen([a for a, _ in pares], [b for _, b in pares])
        cur.execute(
            "insert into sentiment_agreement (n, kappa, concordancia, matriz) values (%s,%s,%s,%s)",
            (c.n, c.kappa, c.concordancia, Jsonb(c.matriz)),
        )
    conn.commit()
    run.contar("pares_kappa", c.n)
