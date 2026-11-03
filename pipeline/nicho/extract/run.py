"""Extração estruturada de notícias e documentos (prompt §5.3).

* Só vão para o LLM itens que citam uma empresa do universo (economiza cota).
* Cache por hash de conteúdo + versão do prompt: o mesmo texto nunca gasta cota duas vezes.
* JSON inválido: uma tentativa de reparo; se falhar de novo, `extraction_failed` (não trava).
* Sem nenhum LLM disponível: extração por regras, marcada como tal.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from nicho.config import Scoring, Universe
from nicho.enrich.models import Sentimento
from nicho.extract.llm import Cadeia, LLMIndisponivel, Resposta
from nicho.extract.rules import extrair_por_regras
from nicho.extract.schema import Extracao
from nicho.paths import repo_root


def carregar_prompt(versao: str) -> str:
    return (repo_root() / "pipeline" / "prompts" / f"{versao}.md").read_text(encoding="utf-8")


def montar_prompt(modelo: str, universe: Universe, texto: str) -> str:
    empresas = "\n".join(f"{a.ticker}: {a.nome}" for a in universe.ativos)
    return modelo.replace("{{empresas}}", empresas).replace("{{texto}}", texto)


REPARO = (
    "\n\nSua resposta anterior não passou na validação do schema.\n"
    "Resposta anterior:\n{anterior}\n\nErros:\n{erros}\n\n"
    "Devolva SOMENTE o JSON corrigido, com todas as chaves do formato e sem inventar dados."
)


def _parse(texto: str) -> Extracao:
    bruto = texto.strip()
    if bruto.startswith("```"):  # alguns modelos embrulham em bloco de código
        bruto = bruto.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
    return Extracao.model_validate(json.loads(bruto))


@dataclass(frozen=True)
class Resultado:
    status: str  # ok | reparado | extraction_failed
    metodo: str  # llm | regras
    extracao: Extracao | None
    provedor: str | None
    modelo: str | None
    do_cache: bool


class Cache:
    """Interface mínima do llm_cache (implementada no banco e em memória nos testes)."""

    def get(self, content_hash: str, prompt_versao: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def put(
        self,
        content_hash: str,
        prompt_versao: str,
        provedor: str,
        modelo: str,
        resposta: dict[str, Any],
    ) -> None:
        raise NotImplementedError


class CacheMemoria(Cache):
    def __init__(self) -> None:
        self.d: dict[tuple[str, str], dict[str, Any]] = {}

    def get(self, content_hash: str, prompt_versao: str) -> dict[str, Any] | None:
        return self.d.get((content_hash, prompt_versao))

    def put(
        self,
        content_hash: str,
        prompt_versao: str,
        provedor: str,
        modelo: str,
        resposta: dict[str, Any],
    ) -> None:
        self.d[(content_hash, prompt_versao)] = {"provedor": provedor, "modelo": modelo, **resposta}


def hash_entrada(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


class Extrator:
    def __init__(
        self,
        cadeia: Cadeia,
        cache: Cache,
        universe: Universe,
        scoring: Scoring,
        prompt_versao: str,
        temperatura: float,
        max_chars: int,
        max_llm: int | None = None,
    ) -> None:
        self.cadeia, self.cache, self.universe, self.scoring = cadeia, cache, universe, scoring
        self.versao = prompt_versao
        self.modelo_prompt = carregar_prompt(prompt_versao)
        self.temperatura = temperatura
        self.max_chars = max_chars
        self.universo = {a.ticker for a in universe.ativos}
        self.llm_esgotado = False
        # Limite de chamadas ao LLM por execução (cota). Regras e cache não contam.
        self.max_llm = max_llm
        self.chamadas_llm = 0

    def extrair(
        self, titulo: str, corpo: str | None, citados: list[str], sentimento: Sentimento | None
    ) -> Resultado:
        texto = f"{titulo}\n\n{corpo}".strip() if corpo else titulo
        texto = texto[: self.max_chars]
        chave = hash_entrada(texto)

        cached = self.cache.get(chave, self.versao)
        if cached is not None:
            ext = Extracao.model_validate(cached["extracao"]).ancorar(self.universo, set(citados))
            return Resultado(
                cached["status"], "llm", ext, cached["provedor"], cached["modelo"], True
            )

        if self.max_llm is not None and self.chamadas_llm >= self.max_llm:
            self.llm_esgotado = True
        if not self.llm_esgotado:
            self.chamadas_llm += 1
            try:
                return self._via_llm(chave, texto, citados)
            except LLMIndisponivel:
                self.llm_esgotado = True  # não insiste pelo resto da execução

        ext = extrair_por_regras(titulo, corpo or "", sorted(citados), sentimento, self.scoring)
        return Resultado("ok", "regras", ext, None, None, False)

    def _via_llm(self, chave: str, texto: str, citados: list[str]) -> Resultado:
        prompt = montar_prompt(self.modelo_prompt, self.universe, texto)
        resp: Resposta = self.cadeia.json(prompt, self.temperatura)
        status = "ok"
        try:
            ext = _parse(resp.texto)
        except (ValueError, ValidationError) as erro:
            reparo = prompt + REPARO.format(anterior=resp.texto[:2000], erros=str(erro)[:1500])
            resp = self.cadeia.json(reparo, 0.0)
            try:
                ext = _parse(resp.texto)
                status = "reparado"
            except (ValueError, ValidationError):
                return Resultado(
                    "extraction_failed", "llm", None, resp.provedor, resp.modelo, False
                )
        self.cache.put(
            chave,
            self.versao,
            resp.provedor,
            resp.modelo,
            {"status": status, "extracao": ext.model_dump(mode="json")},
        )
        return Resultado(
            status,
            "llm",
            ext.ancorar(self.universo, set(citados)),
            resp.provedor,
            resp.modelo,
            False,
        )
