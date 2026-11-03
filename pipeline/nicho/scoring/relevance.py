"""Score de relevância de 0 a 100, decomponível (prompt §5.7).

score = 100 × Σ wᵢ·fᵢ / Σ wᵢ, somando só os fatores disponíveis (fᵢ ∈ [0, 1], pesos em
config/scoring.yaml). Cada fator é guardado com seu peso efetivo e sua contribuição em pontos, para
a interface mostrar "por que isso é relevante".

Só sai da soma (com renormalização dos pesos) o que a plataforma não consegue medir: a centralidade
antes da fase 5, ou a reação de mercado de um ticker sem preços. Desconhecido não é neutro:
materialidade não identificada vale 0, e uma história sem empresa do universo tem reação 0.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from nicho.config import Scoring

MATERIALIDADE = {"baixa": 1 / 3, "media": 2 / 3, "alta": 1.0}
MAX_FONTES = 5  # a partir de 5 fontes independentes o fator satura
Z_SATURA = 6.0  # |z| robusto a partir do qual a reação de mercado satura

ROTULOS = {
    "materialidade": "Materialidade do evento",
    "sentimento_intensidade": "Intensidade do sentimento",
    "fontes_independentes": "Fontes independentes",
    "reacao_mercado": "Reação do mercado",
    "centralidade_grafo": "Centralidade no grafo",
    "novidade": "Novidade",
    "recencia": "Recência",
}


@dataclass(frozen=True)
class EntradaScore:
    materialidade: str | None  # baixa | media | alta (LLM ou regras)
    tipo_evento: str | None
    n_tickers: int  # empresas do universo citadas
    sentimento: float | None  # −1 a +1
    n_fontes: int
    z_retorno: float | None  # z robusto do retorno do ticker no pregão do evento
    z_volume: float | None
    centralidade: float | None  # [0, 1]; None até a fase 5
    novidade: float | None  # [0, 1]
    ultima_em: datetime
    agora: datetime


def fatores(e: EntradaScore, cfg: Scoring) -> dict[str, float | None]:
    f: dict[str, float | None] = {}

    if e.materialidade is None and e.tipo_evento is None:
        f["materialidade"] = 0.0
    else:
        m_llm = MATERIALIDADE.get(e.materialidade or "")
        m_tipo = cfg.materialidade_por_tipo.get(e.tipo_evento or "outro")  # type: ignore[call-overload]
        partes = [x for x in (m_llm, m_tipo) if x is not None]
        f["materialidade"] = sum(partes) / len(partes) if partes else None

    f["sentimento_intensidade"] = None if e.sentimento is None else min(abs(e.sentimento), 1.0)
    f["fontes_independentes"] = min(math.log1p(e.n_fontes) / math.log1p(MAX_FONTES), 1.0)

    if e.n_tickers == 0:
        f["reacao_mercado"] = 0.0
    elif e.z_retorno is None and e.z_volume is None:
        f["reacao_mercado"] = None
    else:
        r = min(abs(e.z_retorno or 0.0), Z_SATURA) / Z_SATURA
        v = min(max(e.z_volume or 0.0, 0.0), Z_SATURA) / Z_SATURA
        f["reacao_mercado"] = 0.7 * r + 0.3 * v

    f["centralidade_grafo"] = e.centralidade
    f["novidade"] = e.novidade

    horas = max((e.agora - e.ultima_em).total_seconds() / 3600, 0.0)
    f["recencia"] = 0.5 ** (horas / cfg.recencia.meia_vida_horas)
    return f


def score(e: EntradaScore, cfg: Scoring) -> tuple[float, dict[str, dict[str, Any]]]:
    pesos = cfg.pesos.model_dump()
    fs = fatores(e, cfg)
    disponiveis = {k: v for k, v in fs.items() if v is not None}
    soma_pesos = sum(pesos[k] for k in disponiveis)
    componentes: dict[str, dict[str, Any]] = {}
    total = 0.0
    for nome, fator in fs.items():
        if fator is None or soma_pesos == 0:
            componentes[nome] = {
                "rotulo": ROTULOS[nome],
                "fator": None,
                "peso": pesos[nome],
                "peso_efetivo": 0.0,
                "pontos": 0.0,
                "disponivel": False,
            }
            continue
        peso_ef = pesos[nome] / soma_pesos
        pontos = 100 * peso_ef * fator
        total += pontos
        componentes[nome] = {
            "rotulo": ROTULOS[nome],
            "fator": round(fator, 4),
            "peso": pesos[nome],
            "peso_efetivo": round(peso_ef, 4),
            "pontos": round(pontos, 2),
            "disponivel": True,
        }
    return round(min(max(total, 0.0), 100.0), 2), componentes
