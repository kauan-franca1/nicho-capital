from datetime import date

import numpy as np
import pandas as pd

from nicho.config import load_config
from nicho.export import build_stats_snapshot
from nicho.stats.anomalies import Anomalia
from nicho.stats.run import compute_anomalies, market_shocks, rotulo_choque

CFG = load_config().stats


def _anom(sev: str, metodo: str = "robust_z_retorno", ret: float = -0.1388) -> Anomalia:
    return Anomalia("^BVSP", date(2026, 10, 26), metodo, -18.5, sev, {"retorno": ret})  # type: ignore[arg-type]


def test_choques_de_mercado_respeitam_severidade_minima() -> None:
    lista = [_anom("baixa"), _anom("media"), _anom("alta"), _anom("alta", "change_point")]
    assert [a.severidade for a in market_shocks(lista, "media")] == ["media", "alta"]
    assert len(market_shocks(lista, "alta")) == 1


def test_rotulo_do_choque_em_portugues() -> None:
    assert rotulo_choque(_anom("alta")) == "Choque de mercado em 26/10/2026 (Ibovespa −13,9%)"
    assert rotulo_choque(_anom("alta", ret=0.077)) == (
        "Choque de mercado em 26/10/2026 (Ibovespa +7,7%)"
    )


def test_indice_nao_gera_anomalia_de_volume() -> None:
    rng = np.random.default_rng(11)
    idx = pd.bdate_range("2024-01-01", periods=300)
    px = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300))), index=idx)
    vol = pd.Series(np.exp(rng.normal(15, 0.2, 300)), index=idx)
    vol.iloc[-1] *= 100
    frame = pd.DataFrame({"px": px, "volume": vol})
    assert any(a.metodo == "robust_z_volume" for a in compute_anomalies("TEST3", frame, CFG))
    assert not any(a.metodo == "robust_z_volume" for a in compute_anomalies("^BVSP", frame, CFG))


def test_build_stats_snapshot() -> None:
    files = build_stats_snapshot(
        anomalias=[
            ("PETR4", date(2026, 10, 30), "robust_z_volume", 4.1, "baixa", {"multiplo": 3.2}),
            ("PETR4", date(2026, 8, 1), "robust_z_retorno", 3.5, "baixa", {}),
            ("VALE3", date(2026, 10, 30), "robust_z_retorno", -7.2, "alta", {}),
        ],
        garch=[
            (
                "PETR4",
                "t",
                0.05,
                0.1,
                0.04,
                0.93,
                6.0,
                0.97,
                23.0,
                0.35,
                -900.0,
                750,
                True,
                date(2026, 10, 30),
                [0.4, 0.39],
                None,
            ),
        ],
        vol=[("PETR4", date(2026, 10, 30), 0.41, 0.38)],
        estudos=[
            (
                "PETR4",
                date(2026, 10, 26),
                "[-1,+1]",
                "mercado",
                "Choque",
                -0.02,
                -0.8,
                0.42,
                -0.08,
                0.03,
                240,
                0.0,
                1.1,
                0.01,
                0.5,
                {"nivel_confianca": 0.95, "dias": [[-1, "2026-10-23", 0.001, 0.001, -0.02, 0.02]]},
            ),
        ],
    )
    petr = files["stats/PETR4.json"]
    assert petr["garch"]["persistencia"] == 0.97
    assert petr["volatilidade"] == [["2026-10-30", 0.41, 0.38]]
    assert petr["event_studies"][0]["janela"] == "[-1,+1]"
    assert petr["event_studies"][0]["dias"][0][:2] == [-1, "2026-10-23"]
    recentes = files["anomalias.json"]["anomalias"]
    # só os últimos 30 dias, mais recentes e mais extremas primeiro
    assert [(a["ticker"], a["dia"]) for a in recentes] == [
        ("VALE3", "2026-10-30"),
        ("PETR4", "2026-10-30"),
    ]
    assert files["stats/VALE3.json"]["garch"] is None
