from datetime import UTC, datetime, timedelta

import pytest

from nicho.config import load_config
from nicho.scoring.relevance import EntradaScore, fatores, score

CFG = load_config().scoring
AGORA = datetime(2026, 10, 31, 12, tzinfo=UTC)


def _e(**kw: object) -> EntradaScore:
    base: dict[str, object] = dict(
        materialidade="alta",
        tipo_evento="M&A",
        n_tickers=1,
        sentimento=-1.0,
        n_fontes=5,
        z_retorno=-6.0,
        z_volume=6.0,
        centralidade=1.0,
        novidade=1.0,
        ultima_em=AGORA,
        agora=AGORA,
    )
    base.update(kw)
    return EntradaScore(**base)  # type: ignore[arg-type]


def test_score_maximo_e_decomposicao_soma_o_total() -> None:
    total, comp = score(_e(), CFG)
    assert total == pytest.approx(100.0)
    assert sum(c["pontos"] for c in comp.values()) == pytest.approx(total, abs=0.05)
    assert all(c["disponivel"] for c in comp.values())


def test_fator_indisponivel_renormaliza_os_pesos() -> None:
    total, comp = score(_e(centralidade=None), CFG)
    assert comp["centralidade_grafo"]["disponivel"] is False
    assert comp["centralidade_grafo"]["pontos"] == 0
    assert sum(c["peso_efetivo"] for c in comp.values()) == pytest.approx(1.0, abs=1e-3)
    assert total == pytest.approx(100.0)  # sem a fase 5, a nota máxima continua sendo 100


def test_recencia_tem_meia_vida_configurada() -> None:
    meia = CFG.recencia.meia_vida_horas
    f = fatores(_e(ultima_em=AGORA - timedelta(hours=meia)), CFG)
    assert f["recencia"] == pytest.approx(0.5)


def test_fontes_saturam_e_reacao_combina_retorno_e_volume() -> None:
    assert fatores(_e(n_fontes=50), CFG)["fontes_independentes"] == 1.0
    assert fatores(_e(n_fontes=1), CFG)["fontes_independentes"] < 0.5
    f = fatores(_e(z_retorno=3.0, z_volume=-2.0), CFG)
    assert f["reacao_mercado"] == pytest.approx(0.7 * 0.5)  # volume baixo não conta


def test_noticia_morna_pontua_menos_que_choque() -> None:
    choque, _ = score(_e(), CFG)
    morna, _ = score(
        _e(
            materialidade="baixa",
            tipo_evento="outro",
            sentimento=0.05,
            n_fontes=1,
            z_retorno=0.3,
            z_volume=0.0,
            novidade=0.1,
            ultima_em=AGORA - timedelta(days=3),
        ),
        CFG,
    )
    assert morna < 30 < choque


def test_desconhecido_nao_infla_o_score() -> None:
    sem_ticker = fatores(_e(n_tickers=0, materialidade=None, tipo_evento=None), CFG)
    assert sem_ticker["materialidade"] == 0.0 and sem_ticker["reacao_mercado"] == 0.0
    vazio, _ = score(
        _e(n_tickers=0, materialidade=None, tipo_evento=None, sentimento=0.0, centralidade=None),
        CFG,
    )
    assert vazio < 40  # só fontes, novidade e recência (≈ 38,9)


def test_ticker_sem_precos_fica_indisponivel() -> None:
    f = fatores(_e(z_retorno=None, z_volume=None), CFG)
    assert f["reacao_mercado"] is None
