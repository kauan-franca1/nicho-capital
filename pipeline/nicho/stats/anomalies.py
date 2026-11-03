"""Detecção de anomalias (prompt §5.5).

* z-score robusto de retorno e de volume contra uma janela móvel do PASSADO (mediana e MAD das
  `janela` observações anteriores a t; a própria observação nunca entra na sua referência);
* change points com PELT (`ruptures`) sobre os log-retornos, detecção retrospectiva.
"""

from __future__ import annotations

import itertools
import math
import warnings
from dataclasses import dataclass, field
from datetime import date
from typing import Any, cast

import numpy as np
import pandas as pd

from nicho.config import AnomaliasCfg, ChangePointsCfg, Severidade

MAD_K = 1.4826  # torna a MAD consistente com o desvio-padrão sob normalidade


@dataclass(frozen=True)
class Anomalia:
    ticker: str
    dia: date
    metodo: str  # robust_z_retorno | robust_z_volume | change_point
    valor: float
    severidade: Severidade
    detalhes: dict[str, Any] = field(default_factory=dict)


def _mad(w: np.ndarray) -> float:
    return float(np.median(np.abs(w - np.median(w))))


def robust_z(x: pd.Series, janela: int, min_obs: int) -> pd.DataFrame:
    """Colunas: valor, mediana, mad, z. A referência de t usa só x_{t−janela} … x_{t−1}."""
    passado = x.shift(1)
    rolling = passado.rolling(janela, min_periods=min_obs)
    mediana = rolling.median()
    mad = rolling.apply(_mad, raw=True)
    escala = MAD_K * mad
    z = (x - mediana) / escala.where(escala > 0)
    return pd.DataFrame({"valor": x, "mediana": mediana, "mad": mad, "z": z})


def _recentes(df: pd.DataFrame, n: int) -> pd.DataFrame:
    return df.iloc[-n:] if n < len(df) else df


def return_anomalies(ticker: str, returns: pd.Series, cfg: AnomaliasCfg) -> list[Anomalia]:
    df = _recentes(robust_z(returns, cfg.janela, cfg.min_obs), cfg.pregoes_recentes)
    out: list[Anomalia] = []
    for dia, row in df.dropna(subset=["z"]).iterrows():
        sev = cfg.limiares.severidade(row["z"])
        if sev:
            out.append(
                Anomalia(
                    ticker,
                    _as_date(dia),
                    "robust_z_retorno",
                    round(float(row["z"]), 3),
                    sev,
                    {
                        "retorno_log": round(float(row["valor"]), 6),
                        "retorno": round(math.expm1(float(row["valor"])), 6),
                        "mediana": round(float(row["mediana"]), 6),
                        "mad": round(float(row["mad"]), 6),
                        "janela": cfg.janela,
                    },
                )
            )
    return out


def volume_anomalies(ticker: str, volume: pd.Series, cfg: AnomaliasCfg) -> list[Anomalia]:
    """Trabalha no log do volume (distribuição muito assimétrica). Volume zero é ignorado."""
    v = volume[volume > 0].astype(float)
    if len(v) < cfg.min_obs + 1:
        return []
    exato = dict(zip(v.index, v.to_numpy(), strict=True))
    log_v = cast(pd.Series, np.log(v))
    df = _recentes(robust_z(log_v, cfg.janela, cfg.min_obs), cfg.pregoes_recentes)
    out: list[Anomalia] = []
    for dia, row in df.dropna(subset=["z"]).iterrows():
        z = float(row["z"])
        if cfg.volume_so_alta and z <= 0:
            continue
        sev = cfg.limiares.severidade(z)
        if sev:
            out.append(
                Anomalia(
                    ticker,
                    _as_date(dia),
                    "robust_z_volume",
                    round(z, 3),
                    sev,
                    {
                        "volume": int(exato[dia]),
                        "volume_mediano": round(math.exp(float(row["mediana"]))),
                        "multiplo": round(math.exp(float(row["valor"]) - float(row["mediana"])), 2),
                        "janela": cfg.janela,
                    },
                )
            )
    return out


@dataclass(frozen=True)
class ChangePoint:
    dia: date
    vol_antes: float  # desvio-padrão diário do segmento anterior
    vol_depois: float

    @property
    def razao(self) -> float:
        return self.vol_depois / self.vol_antes if self.vol_antes > 0 else math.inf


def _custo_normal_1d() -> Any:
    """Custo gaussiano (média e variância) de um segmento: n·ln(σ̂²), em O(1) por somas acumuladas.

    É a mesma função do `model="normal"` do ruptures para séries 1D, mas sem recalcular a
    covariância a cada segmento (que custava ~5 s por ativo).
    """
    from ruptures.base import BaseCost

    class CustoNormal1D(BaseCost):  # type: ignore[misc]
        model = "normal_1d"
        min_size = 2

        def fit(self, signal: np.ndarray) -> CustoNormal1D:
            x = np.asarray(signal, dtype=float).reshape(-1)
            self.signal = x.reshape(-1, 1)  # o Pelt lê `cost.signal.shape`
            self.s1 = np.concatenate([[0.0], np.cumsum(x)])
            self.s2 = np.concatenate([[0.0], np.cumsum(x * x)])
            # piso de variância: evita log(0) em segmentos constantes
            self.piso = max(float(np.var(x)) * 1e-6, 1e-18)
            return self

        def error(self, start: int, end: int) -> float:
            n = end - start
            soma = self.s1[end] - self.s1[start]
            var = (self.s2[end] - self.s2[start] - soma * soma / n) / n
            return float(n * np.log(max(var, self.piso)))

    return CustoNormal1D()


def change_points(returns: pd.Series, cfg: ChangePointsCfg) -> list[ChangePoint]:
    import ruptures as rpt

    r = returns.dropna()
    n = len(r)
    if n < 2 * cfg.tamanho_minimo:
        return []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        algo = rpt.Pelt(custom_cost=_custo_normal_1d(), min_size=cfg.tamanho_minimo, jump=cfg.salto)
        bkps = algo.fit(r.to_numpy()).predict(pen=cfg.penalidade_fator * np.log(n))
    limites = [0, *bkps]
    segs = [r.iloc[a:b] for a, b in itertools.pairwise(limites)]
    out: list[ChangePoint] = []
    for i in range(1, len(segs)):
        out.append(
            ChangePoint(
                dia=_as_date(segs[i].index[0]),
                vol_antes=float(segs[i - 1].std(ddof=1)),
                vol_depois=float(segs[i].std(ddof=1)),
            )
        )
    return out


def change_point_anomalies(ticker: str, returns: pd.Series, cfg: ChangePointsCfg) -> list[Anomalia]:
    out: list[Anomalia] = []
    for cp in change_points(returns, cfg):
        fator = max(cp.razao, 1 / cp.razao) if cp.razao > 0 else math.inf
        sev = cfg.limiares_razao.severidade(fator)
        if sev:
            out.append(
                Anomalia(
                    ticker,
                    cp.dia,
                    "change_point",
                    round(cp.razao, 3),
                    sev,
                    {
                        "vol_antes_anual": round(cp.vol_antes * math.sqrt(252), 4),
                        "vol_depois_anual": round(cp.vol_depois * math.sqrt(252), 4),
                        "direcao": "alta" if cp.razao > 1 else "queda",
                    },
                )
            )
    return out


def _as_date(idx: Any) -> date:
    return idx.date() if hasattr(idx, "date") else idx  # type: ignore[no-any-return]
