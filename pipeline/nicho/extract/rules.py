"""Extração por regras: último recurso quando nenhum LLM está disponível.

Não substitui o LLM. Garante que o pipeline funcione 100% local e sem chaves (prompt §2):
tickers pelos apelidos, tipo de evento por palavras-chave, sentimento do FinBERT e
materialidade derivada do tipo. Marcada como `metodo = 'regras'` e confiança baixa.
"""

from __future__ import annotations

import re
from typing import Literal

from nicho.config import Scoring, TipoEvento
from nicho.enrich.models import Sentimento
from nicho.extract.schema import Extracao, SentimentoLLM
from nicho.ingest.news import normalizar

# Ordem importa: o primeiro padrão que casar define o tipo. Os textos chegam normalizados
# (minúsculas, sem acentos).
REGRAS: list[tuple[TipoEvento, re.Pattern[str]]] = [
    (
        "M&A",
        re.compile(
            r"\b(aquisicao|adquire|fusao|incorporacao|compra d[ao] |venda d[ao] "
            r"|oferta publica de aquisicao|opa\b|cisao|joint venture)"
        ),
    ),
    (
        "resultado",
        re.compile(
            r"\b(lucro|prejuizo|resultado|balanco|ebitda|receita liquida|trimestre|\dt\d{2})"
        ),
    ),
    ("dividendos", re.compile(r"\b(dividendo|juros sobre capital|jcp|proventos)")),
    ("recompra", re.compile(r"\brecompra")),
    ("emissao", re.compile(r"\b(emissao|debentures|follow-on|oferta de acoes|aumento de capital)")),
    ("guidance", re.compile(r"\b(guidance|projecao|projecoes|perspectiva para)")),
    (
        "troca_de_gestao",
        re.compile(
            r"\b(renuncia|novo (ceo|presidente|diretor)|nomeia|eleito presidente|deixa o cargo)"
        ),
    ),
    ("rating", re.compile(r"\b(rating|moody|fitch|s&p|standard & poor|rebaixa|eleva a nota)")),
    (
        "judicial",
        re.compile(r"\b(justica|judicial|processo|tribunal|stf|stj|liminar|recuperacao judicial)"),
    ),
    (
        "regulatório",
        re.compile(
            r"\b(anp|aneel|anatel|cade|cvm|bacen|banco central|regulat|leilao|licitacao|concessao)"
        ),
    ),
    ("macro", re.compile(r"\b(selic|ipca|inflacao|copom|juros|dolar|cambio|eleicao|pib|fiscal)")),
]


def tipo_por_regras(texto: str) -> TipoEvento:
    alvo = normalizar(texto)
    for tipo, padrao in REGRAS:
        if padrao.search(alvo):
            return tipo
    return "outro"


def extrair_por_regras(
    titulo: str,
    texto: str,
    tickers: list[str],
    sentimento: Sentimento | None,
    scoring: Scoring,
) -> Extracao:
    tipo = tipo_por_regras(f"{titulo} {texto}")
    peso = scoring.materialidade_por_tipo.get(tipo, 0.2)
    materialidade: Literal["baixa", "media", "alta"] = (
        "alta" if peso >= 0.75 else "media" if peso >= 0.5 else "baixa"
    )
    s = sentimento or Sentimento("neutro", 0.0, {})
    return Extracao(
        tickers=tickers,
        empresas=[],
        pessoas=[],
        setores=[],
        tipo_evento=tipo,
        valores_monetarios=[],
        sentimento=SentimentoLLM(label=s.label, score=s.score),  # type: ignore[arg-type]
        materialidade_estimada=materialidade,
        horizonte="curto",
        resumo_1_linha=titulo[:300],
        confianca=0.3,
    )
