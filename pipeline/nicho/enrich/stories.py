"""Deduplicação semântica: agrupa notícias quase idênticas em "histórias" (prompt §5.2).

Agrupamento por líder, em ordem cronológica: cada item entra na história mais similar
(cosseno com o item-semente da história ≥ limiar, até `janela` depois do início); senão abre uma
história nova. Comparar com a semente, e não com um centroide que se move, evita a deriva que
junta manchetes genéricas numa história gigante. Os vetores chegam centralizados
(ver `centralizar`).
O número de fontes distintas numa história é um sinal de relevância.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np


@dataclass
class Historia:
    id: int | None  # id no banco (None = nova)
    centroide: np.ndarray
    primeira_em: datetime
    ultima_em: datetime
    fontes: set[str] = field(default_factory=set)
    itens: list[int] = field(default_factory=list)  # ids dos news_items
    n_vetores: int = 0
    novos: list[tuple[int, float]] = field(default_factory=list)  # (item, similaridade)
    tickers: set[str] = field(default_factory=set)

    def adicionar(
        self, item_id: int, vetor: np.ndarray, fonte: str, quando: datetime, sim: float
    ) -> None:
        if self.n_vetores == 0:
            self.centroide = vetor  # a semente da história não muda depois
        self.n_vetores += 1
        self.primeira_em = min(self.primeira_em, quando)
        self.ultima_em = max(self.ultima_em, quando)
        self.fontes.add(fonte)
        self.itens.append(item_id)
        self.novos.append((item_id, sim))


@dataclass(frozen=True)
class ItemVetor:
    id: int
    vetor: np.ndarray  # normalizado (norma 1)
    fonte_id: str
    publicado_em: datetime
    tickers: frozenset[str] = frozenset()


def agrupar(
    itens: Sequence[ItemVetor],
    existentes: list[Historia],
    limiar: float,
    janela: timedelta,
    limiar_mesma_empresa: float | None = None,
) -> list[Historia]:
    """Distribui `itens` entre histórias existentes e novas. Devolve todas as tocadas."""
    historias = list(existentes)
    tocadas: dict[int, Historia] = {}
    for it in sorted(itens, key=lambda x: x.publicado_em):
        melhor: Historia | None = None
        melhor_sim = melhor_folga = -1.0
        for h in historias:
            if abs(it.publicado_em - h.primeira_em) > janela:
                continue
            sim = float(h.centroide @ it.vetor)
            # Citar a mesma empresa é evidência de mesmo assunto: exige menos similaridade.
            exigido = (
                limiar_mesma_empresa
                if limiar_mesma_empresa is not None and it.tickers & h.tickers
                else limiar
            )
            folga = sim - exigido
            if folga >= 0 and (melhor is None or folga > melhor_folga):
                melhor, melhor_sim, melhor_folga = h, sim, folga
        if melhor is None:
            melhor = Historia(None, np.zeros_like(it.vetor), it.publicado_em, it.publicado_em)
            melhor_sim = 1.0
            historias.append(melhor)
        melhor.adicionar(it.id, it.vetor, it.fonte_id, it.publicado_em, melhor_sim)
        melhor.tickers |= it.tickers
        tocadas[id(melhor)] = melhor
    return list(tocadas.values())


def centralizar(vetores: np.ndarray, media: np.ndarray) -> np.ndarray:
    """Subtrai o vetor médio e renormaliza (remove a direção comum do espaço do e5)."""
    v = np.atleast_2d(vetores) - media
    normas = np.linalg.norm(v, axis=1, keepdims=True)
    out: np.ndarray = v / np.where(normas > 0, normas, 1.0)
    return out


def novidade(vetor: np.ndarray, anteriores: np.ndarray) -> float:
    """1 − maior similaridade com histórias anteriores (1 = assunto inédito)."""
    if anteriores.size == 0:
        return 1.0
    return float(np.clip(1.0 - np.max(anteriores @ vetor), 0.0, 1.0))
