"""Retornos e volatilidade realizada."""

from __future__ import annotations

from typing import cast

import numpy as np
import pandas as pd

PREGOES_ANO = 252


def log_returns(prices: pd.Series) -> pd.Series:
    """r_t = ln(P_t / P_{t-1}). Preços não positivos viram NaN e são descartados."""
    p = prices.where(prices > 0)
    return cast(pd.Series, np.log(p / p.shift(1))).dropna()


def realized_vol(returns: pd.Series, janela: int = 21) -> pd.Series:
    """Desvio-padrão amostral móvel dos log-retornos, anualizado por √252."""
    vol = returns.rolling(janela, min_periods=janela).std(ddof=1) * np.sqrt(PREGOES_ANO)
    return cast(pd.Series, vol)
