"""Event study clássico com modelo de mercado (MacKinlay, 1997).

1. Estimação: OLS de R_i = α + β·R_m + ε na janela [T0, T1] (pregões relativos ao evento,
   terminando antes da janela do evento, sem look-ahead).
2. Retorno anormal: AR_t = R_i,t − (α̂ + β̂·R_m,t) para t na janela do evento [a, b].
3. CAR = Σ AR_t. Sob H0 (sem efeito), CAR ~ N(0, L·σ̂²), com L = b − a + 1 e σ̂² = SSR/(T−2).
   t = CAR / (σ̂·√L), graus de liberdade T − 2; intervalo de confiança pela t de Student.

A aproximação L·σ̂² ignora o erro de estimação de α̂ e β̂ (desprezível com T ≥ 120); isso vai
para a página de metodologia.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from scipy import stats as st


@dataclass(frozen=True)
class DiaEvento:
    rel: int
    dia: date
    ar: float
    car: float
    car_ic_inf: float  # banda do CAR acumulado até este dia
    car_ic_sup: float


@dataclass(frozen=True)
class EventStudyResult:
    data_evento: date  # primeiro pregão em ou depois da data pedida
    janela: tuple[int, int]
    alpha: float
    beta: float
    sigma: float
    r2: float
    n_estimacao: int
    car: float
    se_car: float
    t_stat: float
    p_valor: float
    ic_inf: float
    ic_sup: float
    nivel_confianca: float
    dias: list[DiaEvento]

    @property
    def janela_txt(self) -> str:
        a, b = self.janela
        return f"[{a:+d},{b:+d}]".replace("+0", "0")


def _ols(y: np.ndarray, x: np.ndarray) -> tuple[float, float, np.ndarray]:
    x_c = x - x.mean()
    beta = float((x_c * (y - y.mean())).sum() / (x_c**2).sum())
    alpha = float(y.mean() - beta * x.mean())
    return alpha, beta, y - (alpha + beta * x)


def event_study(
    stock: pd.Series,
    market: pd.Series,
    data_evento: date,
    janela: tuple[int, int],
    estimacao: tuple[int, int],
    min_obs: int,
    nivel: float = 0.95,
) -> EventStudyResult | None:
    """Retorna None quando não há dados suficientes ou a janela do evento ainda não terminou."""
    df = pd.concat({"r": stock, "m": market}, axis=1, join="inner").dropna().sort_index()
    if df.empty:
        return None
    idx = pd.DatetimeIndex(df.index)
    pos = int(idx.searchsorted(pd.Timestamp(data_evento)))
    if pos >= len(df):
        return None

    e0, e1 = estimacao
    a, b = janela
    if pos + e0 < 0 or pos + b >= len(df):
        return None  # sem histórico suficiente ou janela incompleta (aguardando pregões)

    est = df.iloc[pos + e0 : pos + e1 + 1]
    if len(est) < min_obs:
        return None
    alpha, beta, resid = _ols(est["r"].to_numpy(), est["m"].to_numpy())
    t_obs = len(est)
    gl = t_obs - 2
    sigma = float(math.sqrt((resid**2).sum() / gl))
    ss_tot = float(((est["r"] - est["r"].mean()) ** 2).sum())
    r2 = 1 - float((resid**2).sum()) / ss_tot if ss_tot > 0 else 0.0

    ev = df.iloc[pos + a : pos + b + 1]
    ar = ev["r"].to_numpy() - (alpha + beta * ev["m"].to_numpy())
    crit = float(st.t.ppf(0.5 + nivel / 2, gl))

    dias: list[DiaEvento] = []
    acumulado = 0.0
    for k, (dia, ar_k) in enumerate(zip(ev.index, ar, strict=True), start=1):
        acumulado += float(ar_k)
        meia = crit * sigma * math.sqrt(k)
        dias.append(
            DiaEvento(
                rel=a + k - 1,
                dia=pd.Timestamp(dia).date(),
                ar=float(ar_k),
                car=acumulado,
                car_ic_inf=acumulado - meia,
                car_ic_sup=acumulado + meia,
            )
        )

    se = sigma * math.sqrt(len(ar))
    t_stat = acumulado / se if se > 0 else math.nan
    p = float(2 * st.t.sf(abs(t_stat), gl)) if se > 0 else math.nan
    return EventStudyResult(
        data_evento=pd.Timestamp(idx[pos]).date(),
        janela=janela,
        alpha=alpha,
        beta=beta,
        sigma=sigma,
        r2=r2,
        n_estimacao=t_obs,
        car=acumulado,
        se_car=se,
        t_stat=t_stat,
        p_valor=p,
        ic_inf=acumulado - crit * se,
        ic_sup=acumulado + crit * se,
        nivel_confianca=nivel,
        dias=dias,
    )
