"""Provedores de LLM para JSON estruturado, com controle de cota e fallback (prompt §2 e §5.3).

Formatos verificados na documentação oficial em 31/10/2026:
* Gemini: POST v1beta/models/{modelo}:generateContent, header `x-goog-api-key`,
  generationConfig.responseMimeType = "application/json";
  texto em candidates[0].content.parts[].text.
* Groq: POST https://api.groq.com/openai/v1/chat/completions (compatível com OpenAI), Bearer,
  response_format {"type": "json_object"} (disponível em todos os modelos).
* Ollama: POST {base}/api/chat com format = "json" e stream = false; texto em message.content.
"""

from __future__ import annotations

import os
import time
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

import httpx

from nicho.config import Llm, Provedor
from nicho.log import get_logger

log = get_logger(__name__)


class LLMIndisponivel(Exception):
    """Provedor sem chave, fora do ar, ou sem cota: a cadeia passa para o próximo."""


@dataclass(frozen=True)
class Resposta:
    texto: str
    provedor: str
    modelo: str
    tokens: int


class Provider(Protocol):
    nome: str
    modelo: str

    def disponivel(self) -> bool: ...
    def json(self, prompt: str, temperatura: float) -> Resposta: ...


# ------------------------------------------------------------------ cota
class UsoDiario(Protocol):
    def requests_hoje(self, provedor: str, dia: date) -> int: ...
    def registrar(self, provedor: str, dia: date, tokens: int) -> None: ...


class UsoEmMemoria:
    def __init__(self) -> None:
        self.uso: dict[tuple[str, date], tuple[int, int]] = {}

    def requests_hoje(self, provedor: str, dia: date) -> int:
        return self.uso.get((provedor, dia), (0, 0))[0]

    def registrar(self, provedor: str, dia: date, tokens: int) -> None:
        r, t = self.uso.get((provedor, dia), (0, 0))
        self.uso[(provedor, dia)] = (r + 1, t + tokens)


class Cota:
    """RPM em janela deslizante (em memória) e RPD persistido (tabela quota_usage)."""

    def __init__(
        self,
        provedor: str,
        rpm: int,
        rpd: int,
        uso: UsoDiario,
        relogio: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
        hoje: Callable[[], date] = date.today,
    ) -> None:
        self.provedor, self.rpm, self.rpd, self.uso = provedor, rpm, rpd, uso
        self.relogio, self.dormir, self.hoje = relogio, dormir, hoje
        self.janela: deque[float] = deque()

    def adquirir(self) -> None:
        if self.rpd and self.uso.requests_hoje(self.provedor, self.hoje()) >= self.rpd:
            raise LLMIndisponivel(
                f"{self.provedor}: cota diária de {self.rpd} requisições esgotada"
            )
        if self.rpm:
            agora = self.relogio()
            while self.janela and agora - self.janela[0] >= 60:
                self.janela.popleft()
            if len(self.janela) >= self.rpm:
                self.dormir(60 - (agora - self.janela[0]) + 0.05)
                agora = self.relogio()
                self.janela.popleft()
            self.janela.append(agora)

    def registrar(self, tokens: int) -> None:
        self.uso.registrar(self.provedor, self.hoje(), tokens)


# ------------------------------------------------------------------ provedores
class _HttpProvider:
    nome = ""

    def __init__(self, cfg: Provedor, cota: Cota, client: httpx.Client | None = None) -> None:
        self.cfg = cfg
        self.modelo = cfg.modelo_extracao
        self.cota = cota
        self.client = client or httpx.Client(timeout=90)

    def disponivel(self) -> bool:
        raise NotImplementedError

    def json(self, prompt: str, temperatura: float) -> Resposta:
        raise NotImplementedError

    def _post(self, url: str, **kwargs: Any) -> dict[str, Any]:
        self.cota.adquirir()
        try:
            r = self.client.post(url, **kwargs)
        except httpx.TransportError as exc:
            raise LLMIndisponivel(f"{self.nome}: {exc!r}") from exc
        if r.status_code in (401, 403, 429) or r.status_code >= 500:
            raise LLMIndisponivel(f"{self.nome}: HTTP {r.status_code} {r.text[:160]!r}")
        r.raise_for_status()
        data: dict[str, Any] = r.json()
        return data


class GeminiProvider(_HttpProvider):
    nome = "gemini"
    BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def disponivel(self) -> bool:
        return bool(os.environ.get(self.cfg.env_chave or "", "").strip())

    def json(self, prompt: str, temperatura: float) -> Resposta:
        data = self._post(
            f"{self.BASE}/{self.modelo}:generateContent",
            headers={"x-goog-api-key": os.environ[self.cfg.env_chave or ""]},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": temperatura,
                },
            },
        )
        partes = data["candidates"][0]["content"]["parts"]
        tokens = int(data.get("usageMetadata", {}).get("totalTokenCount", 0))
        self.cota.registrar(tokens)
        return Resposta("".join(p.get("text", "") for p in partes), self.nome, self.modelo, tokens)


class GroqProvider(_HttpProvider):
    nome = "groq"
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def disponivel(self) -> bool:
        return bool(os.environ.get(self.cfg.env_chave or "", "").strip())

    def json(self, prompt: str, temperatura: float) -> Resposta:
        data = self._post(
            self.URL,
            headers={"Authorization": f"Bearer {os.environ[self.cfg.env_chave or '']}"},
            json={
                "model": self.modelo,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "temperature": temperatura,
            },
        )
        tokens = int(data.get("usage", {}).get("total_tokens", 0))
        self.cota.registrar(tokens)
        return Resposta(data["choices"][0]["message"]["content"], self.nome, self.modelo, tokens)


class OllamaProvider(_HttpProvider):
    nome = "ollama"

    def _base(self) -> str:
        return os.environ.get(self.cfg.env_url or "", "").strip() or "http://localhost:11434"

    def disponivel(self) -> bool:
        try:
            r = self.client.get(f"{self._base()}/api/tags", timeout=2)
            nomes = {m.get("name", "") for m in r.json().get("models", [])}
        except (httpx.HTTPError, ValueError):
            return False
        return any(n == self.modelo or n.startswith(f"{self.modelo}:") for n in nomes)

    def json(self, prompt: str, temperatura: float) -> Resposta:
        data = self._post(
            f"{self._base()}/api/chat",
            json={
                "model": self.modelo,
                "messages": [{"role": "user", "content": prompt}],
                "format": "json",
                "stream": False,
                "options": {"temperature": temperatura},
            },
        )
        tokens = int(data.get("prompt_eval_count", 0)) + int(data.get("eval_count", 0))
        self.cota.registrar(tokens)
        return Resposta(data["message"]["content"], self.nome, self.modelo, tokens)


CLASSES: dict[str, type[_HttpProvider]] = {
    "gemini": GeminiProvider,
    "groq": GroqProvider,
    "ollama": OllamaProvider,
}


def montar_cadeia(cfg: Llm, uso: UsoDiario, client: httpx.Client | None = None) -> list[Provider]:
    out: list[Provider] = []
    for nome in cfg.cadeia:
        p = cfg.provedores[nome]
        cota = Cota(nome, p.cota.rpm, p.cota.rpd, uso)
        out.append(CLASSES[nome](p, cota, client))
    return out


class Cadeia:
    """Tenta cada provedor disponível em ordem; registra quem falhou e por quê."""

    def __init__(self, provedores: Sequence[Provider]) -> None:
        self.provedores = list(provedores)
        self.fora: dict[str, str] = {}

    def ativos(self) -> list[Provider]:
        out = []
        for p in self.provedores:
            if p.nome in self.fora:
                continue
            if not p.disponivel():
                self.fora[p.nome] = "não configurado ou fora do ar"
                continue
            out.append(p)
        return out

    def json(self, prompt: str, temperatura: float) -> Resposta:
        for p in self.ativos():
            try:
                return p.json(prompt, temperatura)
            except LLMIndisponivel as exc:
                log.warning("llm_indisponivel", provedor=p.nome, motivo=str(exc))
                self.fora[p.nome] = str(exc)
        raise LLMIndisponivel("nenhum provedor de LLM disponível")
