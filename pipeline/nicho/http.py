"""Cliente HTTP compartilhado: User-Agent identificado, timeout e retry com backoff (tenacity)."""

from __future__ import annotations

import os
from collections.abc import Callable

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

DEFAULT_UA = "NichoCapital/0.1 (projeto educacional)"


def user_agent() -> str:
    return os.environ.get("COLLECTOR_USER_AGENT", "").strip() or DEFAULT_UA


def make_client(
    timeout: float = 30.0, transport: httpx.BaseTransport | None = None
) -> httpx.Client:
    return httpx.Client(
        timeout=timeout,
        headers={"User-Agent": user_agent()},
        follow_redirects=True,
        transport=transport,
    )


def _retentavel(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return False


def with_retry[T](fn: Callable[[], T], tentativas: int = 4) -> T:
    """Executa `fn` com backoff exponencial em erros de rede, 429 e 5xx."""
    wrapped = retry(
        retry=retry_if_exception(_retentavel),
        stop=stop_after_attempt(tentativas),
        wait=wait_exponential(multiplier=1, min=1, max=20),
        reraise=True,
    )(fn)
    return wrapped()
