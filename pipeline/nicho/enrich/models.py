"""Modelos locais (CPU) carregados sob demanda: embeddings e sentimento.

* Embeddings: intfloat/multilingual-e5-small (MIT, 384 dimensões). O e5 exige prefixos:
  "passage: " para documentos e "query: " para buscas.
* Sentimento: lucas-leme/FinBERT-PT-BR (Apache-2.0). Rótulos verificados no config.json do modelo:
  0 = POSITIVE, 1 = NEGATIVE, 2 = NEUTRAL.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

ROTULOS = {"POSITIVE": "positivo", "NEGATIVE": "negativo", "NEUTRAL": "neutro"}


class Encoder(Protocol):
    def encode_passages(self, textos: Sequence[str]) -> np.ndarray: ...


class E5Encoder:
    def __init__(self, modelo: str, lote: int = 32) -> None:
        self.nome = modelo
        self.lote = lote
        self._m: Any = None

    def _modelo(self) -> Any:
        if self._m is None:
            from sentence_transformers import SentenceTransformer

            self._m = SentenceTransformer(self.nome, device="cpu")
        return self._m

    def encode_passages(self, textos: Sequence[str]) -> np.ndarray:
        if not textos:
            return np.zeros((0, 384), dtype=np.float32)
        vetores = self._modelo().encode(
            [f"passage: {t}" for t in textos],
            batch_size=self.lote,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(vetores, dtype=np.float32)


@dataclass(frozen=True)
class Sentimento:
    label: str  # positivo | neutro | negativo
    score: float  # −1 a +1: P(positivo) − P(negativo)
    probabilidades: dict[str, float]


class SentimentModel(Protocol):
    nome: str

    def classificar(self, textos: Sequence[str]) -> list[Sentimento]: ...


class FinBertPtBr:
    def __init__(self, modelo: str, lote: int = 16) -> None:
        self.nome = modelo
        self.lote = lote
        self._pipe: Any = None

    def _pipeline(self) -> Any:
        if self._pipe is None:
            from transformers import pipeline

            self._pipe = pipeline("text-classification", model=self.nome, device="cpu", top_k=None)
        return self._pipe

    def classificar(self, textos: Sequence[str]) -> list[Sentimento]:
        if not textos:
            return []
        saidas = self._pipeline()(
            list(textos),
            batch_size=self.lote,
            truncation=True,
            max_length=256,
            # O pipeline aplicaria sigmoide por classe; queremos uma distribuição (soma 1).
            function_to_apply="softmax",
        )
        return [de_probabilidades({d["label"]: float(d["score"]) for d in s}) for s in saidas]


def de_probabilidades(probs_modelo: dict[str, float]) -> Sentimento:
    probs = {ROTULOS[k]: v for k, v in probs_modelo.items()}
    label = max(probs, key=lambda k: probs[k])
    score = probs.get("positivo", 0.0) - probs.get("negativo", 0.0)
    return Sentimento(label, round(score, 4), {k: round(v, 4) for k, v in probs.items()})
