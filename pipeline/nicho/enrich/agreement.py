"""Concordância entre dois classificadores de sentimento: kappa de Cohen (prompt §5.4)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

CLASSES = ("negativo", "neutro", "positivo")


@dataclass(frozen=True)
class Concordancia:
    n: int
    kappa: float | None
    concordancia: float | None
    matriz: dict[str, dict[str, int]]  # matriz[rotulo_a][rotulo_b]


def kappa_cohen(a: Sequence[str], b: Sequence[str]) -> Concordancia:
    """κ = (p_o − p_e) / (1 − p_e). Indefinido (None) se não há pares ou p_e = 1."""
    if len(a) != len(b):
        raise ValueError("as duas listas precisam ter o mesmo tamanho")
    matriz = {x: {y: 0 for y in CLASSES} for x in CLASSES}
    for x, y in zip(a, b, strict=True):
        matriz[x][y] += 1
    n = len(a)
    if n == 0:
        return Concordancia(0, None, None, matriz)
    po = sum(matriz[c][c] for c in CLASSES) / n
    pe = sum(
        (sum(matriz[c].values()) / n) * (sum(matriz[x][c] for x in CLASSES) / n) for c in CLASSES
    )
    kappa = None if pe >= 1 else (po - pe) / (1 - pe)
    return Concordancia(n, kappa, po, matriz)
