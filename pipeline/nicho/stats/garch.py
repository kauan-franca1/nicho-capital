"""Volatilidade condicional por GARCH(1,1) (biblioteca `arch`).

σ²_t = ω + α·ε²_{t−1} + β·σ²_{t−1}, com média constante e inovações t de Student (ou normais).
O ajuste é feito em retornos × 100 (escala recomendada pelo `arch` para estabilidade numérica);
as saídas voltam para fração anualizada (× √252 / 100).

Ressalva (vai para a metodologia): os parâmetros são estimados na amostra inteira, então a série
de volatilidade condicional é in-sample. A previsão de h dias usa só informação até o último pregão.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd

from nicho.config import GarchCfg
from nicho.stats.returns import PREGOES_ANO

ESCALA = 100.0


@dataclass(frozen=True)
class GarchFit:
    mu: float
    omega: float
    alpha: float
    beta: float
    nu: float | None
    log_likelihood: float
    n: int
    convergiu: bool
    vol_condicional: pd.Series  # fração anualizada, indexada por data
    previsao: list[float]  # vol anualizada para os próximos h pregões

    @property
    def persistencia(self) -> float:
        return self.alpha + self.beta

    @property
    def meia_vida(self) -> float | None:
        """Pregões até um choque de variância perder metade do efeito: ln(0,5)/ln(α+β)."""
        p = self.persistencia
        return math.log(0.5) / math.log(p) if 0 < p < 1 else None

    @property
    def vol_longo_prazo(self) -> float | None:
        """√(ω / (1 − α − β)) anualizada; só existe se o processo é estacionário."""
        p = self.persistencia
        if not 0 < p < 1:
            return None
        return math.sqrt(self.omega / (1 - p)) / ESCALA * math.sqrt(PREGOES_ANO)


def fit_garch(returns: pd.Series, cfg: GarchCfg) -> GarchFit | None:
    from arch import arch_model

    r = returns.dropna().iloc[-cfg.pregoes :]
    if len(r) < 250:
        return None
    model = arch_model(
        r * ESCALA,
        mean="Constant",
        vol="GARCH",
        p=1,
        q=1,
        dist="t" if cfg.distribuicao == "t" else "normal",
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # avisos de convergência viram o campo `convergiu`
        res = model.fit(disp="off", show_warning=False)
    params = res.params
    fc = res.forecast(horizon=cfg.horizonte_previsao, reindex=False)
    var_h = np.asarray(fc.variance.values[-1], dtype=float)
    anual = math.sqrt(PREGOES_ANO) / ESCALA
    return GarchFit(
        mu=float(params["mu"]),
        omega=float(params["omega"]),
        alpha=float(params["alpha[1]"]),
        beta=float(params["beta[1]"]),
        nu=float(params["nu"]) if "nu" in params else None,
        log_likelihood=float(res.loglikelihood),
        n=len(r),
        convergiu=int(res.convergence_flag) == 0,
        vol_condicional=pd.Series(res.conditional_volatility, index=r.index) * anual,
        previsao=[float(math.sqrt(v) * anual) for v in var_h],
    )
