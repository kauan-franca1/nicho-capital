"""Provedores de cotação com fallback (prompt §2): yfinance → brapi.

Todos devolvem barras diárias normalizadas por ticker B3 (sem o sufixo .SA). Um provedor que
falha ou devolve vazio para um ticker não interrompe nada: o próximo da cadeia tenta de novo.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import httpx

from nicho.http import make_client, with_retry
from nicho.log import get_logger

log = get_logger(__name__)
SP = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class Bar:
    dia: date
    open: float | None
    high: float | None
    low: float | None
    close: float
    adj_close: float | None
    volume: int | None


@dataclass(frozen=True)
class IntradayBar:
    ts: datetime  # com fuso
    close: float
    volume: int | None


class QuoteProvider(Protocol):
    name: str

    def daily(self, tickers: Sequence[str], start: date) -> dict[str, list[Bar]]: ...


def yahoo_symbol(ticker: str) -> str:
    return ticker if ticker.startswith("^") else f"{ticker}.SA"


PRICE_DECIMALS = 4


def _num(v: Any) -> float | None:
    """Número ou None. Arredonda a 4 casas: o Yahoo entrega float32 (52.709999 em vez de 52.71)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, PRICE_DECIMALS)


# ------------------------------------------------------------------ yfinance
class YFinanceProvider:
    """Biblioteca não oficial; a API do Yahoo é para uso pessoal (ver plano §1)."""

    name = "yfinance"

    def daily(self, tickers: Sequence[str], start: date) -> dict[str, list[Bar]]:
        frame = self._download(tickers, start=start.isoformat(), interval="1d")
        return {t: normalize_daily(frame, yahoo_symbol(t)) for t in tickers}

    def intraday(
        self, tickers: Sequence[str], period: str = "5d", interval: str = "15m"
    ) -> dict[str, list[IntradayBar]]:
        frame = self._download(tickers, period=period, interval=interval)
        return {t: normalize_intraday(frame, yahoo_symbol(t)) for t in tickers}

    @staticmethod
    def _download(tickers: Sequence[str], **kwargs: Any) -> Any:
        import yfinance as yf

        with warnings.catch_warnings():
            # pandas 3.x avisa sobre `inplace` dentro do próprio yfinance; não é nosso código.
            warnings.simplefilter("ignore")
            return yf.download(
                [yahoo_symbol(t) for t in tickers],
                auto_adjust=False,
                group_by="ticker",
                progress=False,
                threads=True,
                **kwargs,
            )


def _sub_frame(frame: Any, symbol: str) -> Any | None:
    if frame is None or getattr(frame, "empty", True):
        return None
    cols = frame.columns
    if getattr(cols, "nlevels", 1) == 2:
        if symbol not in cols.get_level_values(0):
            return None
        return frame[symbol]
    return frame


def normalize_daily(frame: Any, symbol: str) -> list[Bar]:
    """DataFrame do yf.download (group_by='ticker') → barras; ignora linhas sem fechamento."""
    sub = _sub_frame(frame, symbol)
    if sub is None:
        return []
    bars: list[Bar] = []
    for idx, row in sub.iterrows():
        close = _num(row.get("Close"))
        if close is None:
            continue
        vol = _num(row.get("Volume"))
        bars.append(
            Bar(
                dia=idx.date(),
                open=_num(row.get("Open")),
                high=_num(row.get("High")),
                low=_num(row.get("Low")),
                close=close,
                adj_close=_num(row.get("Adj Close")),
                volume=int(vol) if vol is not None else None,
            )
        )
    return bars


def normalize_intraday(frame: Any, symbol: str) -> list[IntradayBar]:
    sub = _sub_frame(frame, symbol)
    if sub is None:
        return []
    out: list[IntradayBar] = []
    for idx, row in sub.iterrows():
        close = _num(row.get("Close"))
        if close is None:
            continue
        ts = idx.to_pydatetime()
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=SP)
        vol = _num(row.get("Volume"))
        out.append(IntradayBar(ts=ts, close=close, volume=int(vol) if vol is not None else None))
    return out


# ------------------------------------------------------------------ brapi
class BrapiProvider:
    """Fallback. Plano gratuito (verificado em 31/10/2026): 15 mil req/mês, só 1d, até 3 meses,
    1 ativo por requisição. Sem token, só o sandbox (PETR4, VALE3, MGLU3, ITUB4)."""

    name = "brapi"
    BASE = "https://brapi.dev/api/quote/"

    def __init__(self, token: str | None = None, client: httpx.Client | None = None) -> None:
        self.token = token or None
        self.client = client or make_client()

    def daily(self, tickers: Sequence[str], start: date) -> dict[str, list[Bar]]:
        out: dict[str, list[Bar]] = {}
        for t in tickers:
            if t.startswith("^"):
                continue  # o índice não é coberto pelo fallback
            try:
                out[t] = [b for b in self._fetch(t) if b.dia >= start]
            except httpx.HTTPError as exc:
                log.warning("brapi_falhou", ticker=t, erro=str(exc))
        return out

    def _fetch(self, ticker: str) -> list[Bar]:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

        def call() -> dict[str, Any]:
            r = self.client.get(
                f"{self.BASE}{ticker}",
                params={"range": "3mo", "interval": "1d"},
                headers=headers,
            )
            r.raise_for_status()
            data: dict[str, Any] = r.json()
            return data

        return parse_brapi(with_retry(call))


def parse_brapi(payload: dict[str, Any]) -> list[Bar]:
    results = payload.get("results") or []
    if not results:
        return []
    bars: list[Bar] = []
    for p in results[0].get("historicalDataPrice") or []:
        close = _num(p.get("close"))
        if close is None or p.get("date") is None:
            continue
        dia = datetime.fromtimestamp(int(p["date"]), tz=UTC).astimezone(SP).date()
        vol = _num(p.get("volume"))
        bars.append(
            Bar(
                dia=dia,
                open=_num(p.get("open")),
                high=_num(p.get("high")),
                low=_num(p.get("low")),
                close=close,
                adj_close=_num(p.get("adjustedClose")),
                volume=int(vol) if vol is not None else None,
            )
        )
    return bars


# ------------------------------------------------------------------ cadeia
@dataclass
class ChainResult:
    bars: dict[str, list[Bar]] = field(default_factory=dict)
    fonte: dict[str, str] = field(default_factory=dict)
    sem_dados: list[str] = field(default_factory=list)


def fetch_daily_with_fallback(
    providers: Sequence[QuoteProvider], tickers: Sequence[str], start: date
) -> ChainResult:
    result = ChainResult()
    pendentes = list(tickers)
    for provider in providers:
        if not pendentes:
            break
        try:
            got = provider.daily(pendentes, start)
        except Exception as exc:  # provedor inteiro fora do ar: segue para o próximo
            log.warning("provedor_falhou", provedor=provider.name, erro=repr(exc))
            continue
        for t in list(pendentes):
            bars = got.get(t) or []
            if bars:
                result.bars[t] = bars
                result.fonte[t] = provider.name
                pendentes.remove(t)
    result.sem_dados = pendentes
    return result
