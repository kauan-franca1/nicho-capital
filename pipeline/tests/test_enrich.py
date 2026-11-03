from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from nicho.enrich.agreement import kappa_cohen
from nicho.enrich.models import de_probabilidades
from nicho.enrich.stories import ItemVetor, agrupar, novidade

T0 = datetime(2026, 10, 26, 12, tzinfo=UTC)


def _v(*xs: float) -> np.ndarray:
    v = np.array(xs, dtype=np.float32)
    return v / np.linalg.norm(v)


def test_agrupa_parafrases_e_separa_assuntos() -> None:
    itens = [
        ItemVetor(1, _v(1, 0, 0.05), "estadao", T0),
        ItemVetor(2, _v(1, 0.02, 0), "valor", T0 + timedelta(hours=2)),
        ItemVetor(3, _v(0, 1, 0), "estadao", T0 + timedelta(hours=3)),
        ItemVetor(4, _v(1, 0, 0), "infomoney", T0 + timedelta(days=5)),  # fora da janela
    ]
    hs = agrupar(itens, [], limiar=0.95, janela=timedelta(hours=72))
    grupos = sorted(sorted(h.itens) for h in hs)
    assert grupos == [[1, 2], [3], [4]]
    dupla = next(h for h in hs if len(h.itens) == 2)
    assert dupla.fontes == {"estadao", "valor"}
    assert dupla.ultima_em == T0 + timedelta(hours=2)
    assert float(np.linalg.norm(dupla.centroide)) == pytest.approx(1.0)


def test_item_novo_entra_em_historia_existente() -> None:
    existente = agrupar([ItemVetor(1, _v(1, 0, 0), "a", T0)], [], 0.95, timedelta(hours=72))[0]
    existente.id, existente.novos = 99, []
    (h,) = agrupar(
        [ItemVetor(2, _v(1, 0.01, 0), "b", T0 + timedelta(hours=1))],
        [existente],
        0.95,
        timedelta(hours=72),
    )
    assert h.id == 99 and h.novos[0][0] == 2


def test_novidade() -> None:
    assert novidade(_v(1, 0), np.zeros((0,))) == 1.0
    assert novidade(_v(1, 0), np.array([_v(1, 0)])) == pytest.approx(0.0)
    assert novidade(_v(1, 0), np.array([_v(0, 1)])) == pytest.approx(1.0)


def test_kappa_valores_conhecidos() -> None:
    assert kappa_cohen(["positivo", "negativo"], ["positivo", "negativo"]).kappa == pytest.approx(1)
    # Exemplo clássico 2x2: po = 0,7; pe = 0,5 → κ = 0,4
    a = ["positivo"] * 5 + ["negativo"] * 5
    b = ["positivo"] * 4 + ["negativo"] + ["positivo"] * 2 + ["negativo"] * 3
    c = kappa_cohen(a, b)
    assert c.concordancia == pytest.approx(0.7)
    assert c.kappa == pytest.approx(0.4)
    assert c.matriz["positivo"]["negativo"] == 1
    assert kappa_cohen([], []).kappa is None


def test_de_probabilidades() -> None:
    s = de_probabilidades({"POSITIVE": 0.1, "NEGATIVE": 0.7, "NEUTRAL": 0.2})
    assert s.label == "negativo" and s.score == pytest.approx(-0.6)


def test_mesma_empresa_exige_menos_similaridade() -> None:
    a = ItemVetor(1, _v(1, 0, 0), "a", T0, frozenset({"TIMS3"}))
    b = ItemVetor(2, _v(1, 1.1, 0), "b", T0 + timedelta(hours=1), frozenset({"TIMS3"}))  # cos≈0,67
    c = ItemVetor(3, _v(1, 1.1, 0), "c", T0 + timedelta(hours=1), frozenset({"VIVT3"}))
    juntos = agrupar([a, b], [], 0.70, timedelta(hours=72), limiar_mesma_empresa=0.58)
    assert sorted(len(h.itens) for h in juntos) == [2]
    separados = agrupar([a, c], [], 0.70, timedelta(hours=72), limiar_mesma_empresa=0.58)
    assert sorted(len(h.itens) for h in separados) == [1, 1]
