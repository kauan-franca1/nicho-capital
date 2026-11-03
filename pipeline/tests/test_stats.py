"""Estatística contra valores conhecidos (prompt §5.9): dados sintéticos com efeito conhecido."""

import math
from datetime import date

import numpy as np
import pandas as pd
import pytest

from nicho.config import load_config
from nicho.stats.anomalies import (
    MAD_K,
    change_point_anomalies,
    change_points,
    return_anomalies,
    robust_z,
    volume_anomalies,
)
from nicho.stats.event_study import event_study
from nicho.stats.garch import fit_garch
from nicho.stats.returns import log_returns, realized_vol

CFG = load_config().stats


def _dias(n: int, inicio: str = "2023-01-02") -> pd.DatetimeIndex:
    return pd.bdate_range(inicio, periods=n)


# ------------------------------------------------------------------ retornos
def test_log_returns_e_vol_realizada() -> None:
    p = pd.Series([100.0, 110.0, 99.0, 0.0, 120.0], index=_dias(5))
    r = log_returns(p)
    assert r.iloc[0] == pytest.approx(math.log(1.1))
    assert r.iloc[1] == pytest.approx(math.log(0.9))
    assert len(r) == 2  # o preço zero invalida os dois retornos que o envolvem

    alterna = pd.Series([0.01, -0.01] * 15, index=_dias(30))
    vol = realized_vol(alterna, janela=21)
    esperado = alterna.iloc[:21].std(ddof=1) * math.sqrt(252)
    assert vol.iloc[20] == pytest.approx(esperado)
    assert vol.iloc[:20].isna().all()


# ------------------------------------------------------------------ z robusto
def test_robust_z_valor_conhecido() -> None:
    # janela passada = [1, 2, 3, 4, 5]: mediana 3, MAD 1 → z(13) = 10 / 1,4826
    x = pd.Series([1.0, 2, 3, 4, 5, 13], index=_dias(6))
    df = robust_z(x, janela=5, min_obs=5)
    assert df["mediana"].iloc[-1] == 3
    assert df["mad"].iloc[-1] == 1
    assert df["z"].iloc[-1] == pytest.approx(10 / MAD_K)
    assert df["z"].iloc[:5].isna().all()


def test_robust_z_sem_look_ahead() -> None:
    rng = np.random.default_rng(1)
    x = pd.Series(rng.normal(size=200), index=_dias(200))
    base = robust_z(x, 60, 40)["z"]
    alterado = x.copy()
    alterado.iloc[150:] += 50  # mudar o futuro não pode mexer no passado
    z2 = robust_z(alterado, 60, 40)["z"]
    pd.testing.assert_series_equal(base.iloc[:150], z2.iloc[:150])


def test_robust_z_mad_zero_nao_gera_infinito() -> None:
    x = pd.Series([1.0] * 50 + [2.0], index=_dias(51))
    assert robust_z(x, 40, 40)["z"].isna().iloc[-1]


def test_anomalia_de_retorno_e_severidade() -> None:
    rng = np.random.default_rng(2)
    r = pd.Series(rng.normal(0, 0.01, 300), index=_dias(300))
    r.iloc[-1] = 0.12  # ~12σ
    an = return_anomalies("TEST3", r, CFG.anomalias)
    ultimo = [a for a in an if a.dia == r.index[-1].date()]
    assert ultimo and ultimo[0].severidade == "alta"
    assert ultimo[0].detalhes["retorno"] == pytest.approx(math.expm1(0.12), abs=1e-6)


def test_volume_so_detecta_volume_alto() -> None:
    rng = np.random.default_rng(3)
    v = pd.Series(np.exp(rng.normal(15, 0.2, 200)), index=_dias(200))
    v.iloc[-2] = v.iloc[-2] / 50  # volume muito baixo: ignorado
    v.iloc[-1] = v.iloc[:-2].median() * 20  # volume 20x: anomalia
    an = volume_anomalies("TEST3", v, CFG.anomalias)
    dias = {a.dia for a in an}
    assert v.index[-1].date() in dias
    assert v.index[-2].date() not in dias
    assert an[-1].detalhes["multiplo"] > 10


# ------------------------------------------------------------------ change points
def test_change_point_encontra_mudanca_de_volatilidade() -> None:
    rng = np.random.default_rng(4)
    r = pd.Series(np.r_[rng.normal(0, 0.01, 300), rng.normal(0, 0.04, 200)], index=_dias(500))
    cps = change_points(r, CFG.change_points)
    assert len(cps) == 1
    assert abs(r.index.get_loc(pd.Timestamp(cps[0].dia)) - 300) <= 5
    assert cps[0].razao == pytest.approx(4, rel=0.2)
    an = change_point_anomalies("TEST3", r, CFG.change_points)
    assert an[0].severidade == "alta" and an[0].detalhes["direcao"] == "alta"


def test_change_point_ruido_estacionario_nao_dispara() -> None:
    rng = np.random.default_rng(5)
    r = pd.Series(rng.normal(0, 0.015, 600), index=_dias(600))
    assert change_points(r, CFG.change_points) == []


# ------------------------------------------------------------------ GARCH
def _simula_garch(n: int, omega: float, alpha: float, beta: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    var = omega / (1 - alpha - beta)
    out = np.empty(n)
    for t in range(n):
        out[t] = math.sqrt(var) * rng.standard_normal()
        var = omega + alpha * out[t] ** 2 + beta * var
    return out


def test_garch_recupera_parametros_conhecidos() -> None:
    # Retornos em fração; ω na escala ×100 = 0,05 → vol de longo prazo = √(0,05/0,05) = 1% ao dia.
    x = _simula_garch(4000, omega=0.05, alpha=0.08, beta=0.87, seed=6) / 100
    r = pd.Series(x, index=_dias(4000, "2010-01-04"))
    cfg = CFG.garch.model_copy(update={"pregoes": 4000, "distribuicao": "normal"})
    fit = fit_garch(r, cfg)
    assert fit is not None and fit.convergiu
    assert fit.alpha == pytest.approx(0.08, abs=0.03)
    assert fit.beta == pytest.approx(0.87, abs=0.04)
    assert fit.persistencia == pytest.approx(0.95, abs=0.02)
    assert fit.vol_longo_prazo == pytest.approx(0.01 * math.sqrt(252), rel=0.25)
    assert fit.meia_vida == pytest.approx(math.log(0.5) / math.log(fit.persistencia))
    assert len(fit.previsao) == cfg.horizonte_previsao
    assert len(fit.vol_condicional) == 4000


def test_garch_com_pouca_historia_retorna_none() -> None:
    r = pd.Series(np.zeros(100), index=_dias(100))
    assert fit_garch(r, CFG.garch) is None


# ------------------------------------------------------------------ event study
def _mercado_e_acao(seed: int, efeito: float, n: int = 400) -> tuple[pd.Series, pd.Series, date]:
    rng = np.random.default_rng(seed)
    idx = _dias(n)
    m = pd.Series(rng.normal(0.0003, 0.012, n), index=idx)
    r = 0.0002 + 1.3 * m + pd.Series(rng.normal(0, 0.008, n), index=idx)
    evento = idx[300]
    r.loc[evento] += efeito
    return r, m, evento.date()


def test_event_study_recupera_efeito_sintetico_conhecido() -> None:
    r, m, dia = _mercado_e_acao(seed=7, efeito=0.06)
    es = event_study(r, m, dia, (-1, 1), (-250, -11), 120, 0.95)
    assert es is not None
    assert es.beta == pytest.approx(1.3, abs=0.1)
    assert es.n_estimacao == 240
    assert es.car == pytest.approx(0.06, abs=3 * es.sigma * math.sqrt(3))
    assert es.t_stat > 3 and es.p_valor < 0.01
    assert es.ic_inf > 0  # o intervalo de 95% exclui zero
    assert [d.rel for d in es.dias] == [-1, 0, 1]
    assert es.dias[-1].car == pytest.approx(es.car)
    assert es.janela_txt == "[-1,+1]"


def test_event_study_sem_efeito_nao_e_significativo() -> None:
    # Com efeito zero, o CAR deve cair no intervalo em ~95% dos casos: checa a calibração.
    rejeicoes = 0
    for seed in range(200):
        r, m, dia = _mercado_e_acao(seed=1000 + seed, efeito=0.0)
        es = event_study(r, m, dia, (0, 5), (-250, -11), 120, 0.95)
        assert es is not None
        rejeicoes += es.p_valor < 0.05
    assert rejeicoes / 200 == pytest.approx(0.05, abs=0.04)


def test_event_study_sem_look_ahead() -> None:
    r, m, dia = _mercado_e_acao(seed=8, efeito=0.06)
    base = event_study(r, m, dia, (-1, 1), (-250, -11), 120)
    r2 = r.copy()
    r2.iloc[310:] += 0.5  # o futuro depois da janela não pode mudar nada
    depois = event_study(r2, m, dia, (-1, 1), (-250, -11), 120)
    assert base is not None and depois is not None
    assert depois.beta == base.beta and depois.car == base.car


def test_event_study_janela_incompleta_ou_sem_historico() -> None:
    r, m, _ = _mercado_e_acao(seed=9, efeito=0.0)
    assert event_study(r, m, r.index[-3].date(), (0, 5), (-250, -11), 120) is None
    assert event_study(r, m, r.index[100].date(), (-1, 1), (-250, -11), 120) is None


def test_event_study_evento_em_dia_sem_pregao_usa_o_proximo() -> None:
    r, m, _ = _mercado_e_acao(seed=10, efeito=0.0)
    sabado = (r.index[300] - pd.Timedelta(days=r.index[300].day_of_week + 2)).date()
    es = event_study(r, m, sabado, (-1, 1), (-250, -11), 120)
    assert es is not None and es.data_evento.weekday() == 0
