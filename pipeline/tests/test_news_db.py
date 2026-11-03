"""Notícias ponta a ponta num schema temporário: enriquecer (sem LLM) → histórias → score."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import numpy as np
import psycopg
import pytest

from nicho import db
from nicho.config import load_config
from nicho.enrich import run as er
from nicho.enrich.models import Sentimento
from nicho.extract.llm import Cadeia
from nicho.extract.run import CacheMemoria, Extrator
from nicho.ingest.news import MatcherTickers, NewsItem
from nicho.runs import MemoryRecorder, track_run
from nicho.scoring.run import pontuar_historias

pytestmark = pytest.mark.db
CFG = load_config()
AGORA = datetime(2026, 10, 27, 12, tzinfo=UTC)


class EncoderFalso:
    """Vetor por assunto: manchetes que citam a mesma palavra-chave ficam quase idênticas."""

    ASSUNTOS = ("Magazine", "Petrobras", "Copom")

    def encode_passages(self, textos: Sequence[str]) -> np.ndarray:
        out = np.zeros((len(textos), 384), dtype=np.float32)
        for i, t in enumerate(textos):
            k = next((j for j, a in enumerate(self.ASSUNTOS) if a in t), 3)
            out[i, k] = 1.0
            out[i, 10 + i] = 0.05  # ruído pequeno: paráfrases, não cópias
            out[i] /= np.linalg.norm(out[i])
        return out


class SentimentoFalso:
    nome = "falso"

    def classificar(self, textos: Sequence[str]) -> list[Sentimento]:
        return [
            Sentimento("negativo", -0.9, {"negativo": 0.95})
            if "cai" in t
            else Sentimento("neutro", 0.0, {"neutro": 1.0})
            for t in textos
        ]


def _noticias(conn: psycopg.Connection) -> None:
    m = MatcherTickers(CFG.universe.ativos)
    itens = [
        NewsItem(
            "estadao",
            "Estadão",
            "Magazine Luiza cai quase 60% após eleição",
            "l1",
            None,
            AGORA - timedelta(hours=20),
            "google_news",
        ),
        NewsItem(
            "valor",
            "Valor",
            "Ações da Magazine Luiza cai forte",
            "l2",
            None,
            AGORA - timedelta(hours=18),
            "rss",
        ),
        NewsItem(
            "infomoney",
            "InfoMoney",
            "Copom mantém juros",
            "l3",
            None,
            AGORA - timedelta(hours=5),
            "rss",
        ),
    ]
    with conn.cursor() as cur:
        for it in itens:
            cur.execute(
                "insert into news_items (content_hash, fonte_id, fonte_nome, titulo, link, "
                "publicado_em, coletado_via, tickers) values (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    it.content_hash,
                    it.fonte_id,
                    it.fonte_nome,
                    it.titulo,
                    it.link,
                    it.publicado_em,
                    it.coletado_via,
                    list(m.tickers(it.titulo)),
                ),
            )
        cur.execute(
            "insert into filings (protocolo_entrega, versao, ticker, categoria, assunto, "
            "data_entrega, link_download, texto, texto_status) values "
            "('P1', 1, 'PETR4', 'Fato Relevante', 'Petrobras informa aquisição de ativo', %s, "
            "'https://rad/x', 'Petrobras informa a aquisição de participação.', 'ok')",
            (AGORA - timedelta(hours=10),),
        )
    conn.commit()


def test_enriquecer_e_pontuar(pg_isolado: psycopg.Connection) -> None:
    conn = pg_isolado
    db.upsert_assets(conn, CFG.universe)
    _noticias(conn)
    desde = AGORA - timedelta(days=7)
    rec = MemoryRecorder()
    with track_run(rec, "enriquecer") as run:
        er.gerar_embeddings(conn, EncoderFalso(), run, desde)
        er.agrupar_historias(conn, CFG, run, desde)
        er.agrupar_historias(conn, CFG, run, desde)  # idempotente: nada novo para agrupar
        er.classificar_sentimento(conn, SentimentoFalso(), run, desde)
        n = CFG.nlp.extracao
        extrator = Extrator(
            Cadeia([]),
            CacheMemoria(),
            CFG.universe,
            CFG.scoring,
            n.prompt_versao,
            n.temperatura,
            n.max_caracteres_entrada,
        )
        er.extrair(conn, CFG, extrator, "falso", run, desde)
        er.agregar_historias(conn, "falso", run, desde)
        er.calcular_concordancia(conn, "falso", run)
    assert run.contagens["historias_novas"] == 3
    assert run.contagens["extracao_regras_ok"] == 3  # 2 notícias com ticker + 1 fato relevante

    with conn.cursor() as cur:
        cur.execute(
            "select titulo, tickers, fontes, n_fontes, tipo_evento, materialidade, "
            "sentimento from stories order by n_fontes desc, titulo"
        )
        rows = cur.fetchall()
    magalu, *_ = rows
    assert magalu[1] == ["MGLU3"] and magalu[3] == 2 and magalu[2] == ["Estadão", "Valor"]
    assert magalu[6] == pytest.approx(-0.9)
    fato = next(r for r in rows if r[1] == ["PETR4"])
    assert fato[0].startswith("Fato Relevante: Petrobras") and fato[4] == "M&A"
    assert fato[5] == "alta"

    with track_run(rec, "pontuar") as run:
        pontuar_historias(conn, CFG, run, AGORA, desde)
    with conn.cursor() as cur:
        cur.execute(
            "select s.tickers, r.score, r.componentes from relevance_scores r "
            "join stories s on s.id = r.story_id"
        )
        scores = {tuple(t): (sc, comp) for t, sc, comp in cur.fetchall()}
    assert len(scores) == 3
    _, comp = scores[("MGLU3",)]
    assert comp["centralidade_grafo"]["disponivel"] is False
    assert sum(c["pontos"] for c in comp.values()) == pytest.approx(scores[("MGLU3",)][0], abs=0.1)
    # sem preços no schema de teste: a reação de mercado fica indisponível, não zero
    assert comp["reacao_mercado"]["disponivel"] is False
    assert all(0 <= sc <= 100 for sc, _ in scores.values())
