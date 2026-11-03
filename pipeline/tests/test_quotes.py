import json
from collections.abc import Sequence
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from nicho.providers.quotes import (
    Bar,
    BrapiProvider,
    fetch_daily_with_fallback,
    normalize_daily,
    normalize_intraday,
    parse_brapi,
    yahoo_symbol,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _yf_frame() -> pd.DataFrame:
    """Imita o yf.download(group_by='ticker') com dois símbolos e um NaN."""
    idx = pd.DatetimeIndex(["2026-10-29", "2026-10-30"], name="Date")
    campos = ["Open", "High", "Low", "Close", "Adj Close", "Volume"]
    cols = pd.MultiIndex.from_product([["PETR4.SA", "^BVSP"], campos])
    data = [
        [52.05, 53.03, 51.75, 52.20, 52.20, 51969000, 130.0, 131.0, 129.0, 130.5, 130.5, 0],
        [52.45, 53.66, 52.36, 52.71, 52.71, 61743200, np.nan, np.nan, np.nan, np.nan, np.nan, 0],
    ]
    return pd.DataFrame(data, index=idx, columns=cols)


def test_yahoo_symbol() -> None:
    assert yahoo_symbol("PETR4") == "PETR4.SA"
    assert yahoo_symbol("^BVSP") == "^BVSP"


def test_normalize_daily_extrai_barras_e_pula_nan() -> None:
    frame = _yf_frame()
    petr = normalize_daily(frame, "PETR4.SA")
    assert [b.dia for b in petr] == [date(2026, 10, 29), date(2026, 10, 30)]
    assert petr[-1].close == 52.71 and petr[-1].volume == 61743200
    bvsp = normalize_daily(frame, "^BVSP")
    assert len(bvsp) == 1  # a linha com fechamento NaN é descartada


def test_normalize_daily_simbolo_ausente() -> None:
    assert normalize_daily(_yf_frame(), "VALE3.SA") == []
    assert normalize_daily(pd.DataFrame(), "VALE3.SA") == []


def test_normalize_intraday_preserva_fuso() -> None:
    idx = pd.DatetimeIndex(
        ["2026-10-30 16:30", "2026-10-30 16:45"], tz="America/Sao_Paulo", name="Datetime"
    )
    cols = pd.MultiIndex.from_product([["PETR4.SA"], ["Close", "Volume"]])
    frame = pd.DataFrame([[52.6, 1000], [52.71, 2000]], index=idx, columns=cols)
    bars = normalize_intraday(frame, "PETR4.SA")
    assert bars[-1].ts.utcoffset() is not None
    assert bars[-1].ts.isoformat() == "2026-10-30T16:45:00-03:00"


def test_parse_brapi_com_resposta_real() -> None:
    payload = json.loads((FIXTURES / "brapi_petr4_5d.json").read_text(encoding="utf-8"))
    bars = parse_brapi(payload)
    assert len(bars) == 5
    assert all(b.close > 0 for b in bars)
    # timestamps 03:00 UTC viram o próprio dia em São Paulo
    assert bars[-1].dia == date(2026, 10, 30)
    assert bars[-1].close == 52.71


def test_parse_brapi_vazio() -> None:
    assert parse_brapi({"results": []}) == []


def test_brapi_ignora_indice_e_registra_erro_http() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "PETR4" in request.url.path:
            body = (FIXTURES / "brapi_petr4_5d.json").read_bytes()
            return httpx.Response(200, content=body)
        return httpx.Response(401, json={"error": True, "code": "MISSING_TOKEN"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    got = BrapiProvider(client=client).daily(["^BVSP", "PETR4", "WEGE3"], date(2026, 10, 28))
    assert set(got) == {"PETR4"}
    assert [b.dia for b in got["PETR4"]] == [
        date(2026, 10, 28),
        date(2026, 10, 29),
        date(2026, 10, 30),
    ]


class _Fake:
    def __init__(self, name: str, cobre: set[str], explode: bool = False) -> None:
        self.name = name
        self.cobre = cobre
        self.explode = explode
        self.pedidos: list[list[str]] = []

    def daily(self, tickers: Sequence[str], start: date) -> dict[str, list[Bar]]:
        self.pedidos.append(list(tickers))
        if self.explode:
            raise RuntimeError("fora do ar")
        bar = Bar(start, None, None, None, 10.0, None, None)
        return {t: [bar] for t in tickers if t in self.cobre}


def test_fallback_pede_ao_segundo_so_o_que_faltou() -> None:
    a = _Fake("a", {"PETR4"})
    b = _Fake("b", {"VALE3"})
    r = fetch_daily_with_fallback([a, b], ["PETR4", "VALE3", "XXXX3"], date(2026, 1, 1))
    assert r.fonte == {"PETR4": "a", "VALE3": "b"}
    assert b.pedidos == [["VALE3", "XXXX3"]]
    assert r.sem_dados == ["XXXX3"]


def test_fallback_sobrevive_a_provedor_fora_do_ar() -> None:
    a = _Fake("a", set(), explode=True)
    b = _Fake("b", {"PETR4"})
    r = fetch_daily_with_fallback([a, b], ["PETR4"], date(2026, 1, 1))
    assert r.fonte == {"PETR4": "b"} and r.sem_dados == []
