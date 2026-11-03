"""Schema da extração estruturada (prompt §5.3), validado por Pydantic."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from nicho.config import TipoEvento


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Pessoa(_Base):
    nome: str = Field(min_length=1)
    cargo: str = ""


class ValorMonetario(_Base):
    valor: float
    moeda: str = "BRL"
    contexto: str = ""


class SentimentoLLM(_Base):
    label: Literal["positivo", "neutro", "negativo"]
    score: float = Field(ge=-1, le=1)


class Extracao(_Base):
    tickers: list[str] = Field(default_factory=list)
    empresas: list[str] = Field(default_factory=list)
    pessoas: list[Pessoa] = Field(default_factory=list)
    setores: list[str] = Field(default_factory=list)
    tipo_evento: TipoEvento
    valores_monetarios: list[ValorMonetario] = Field(default_factory=list)
    sentimento: SentimentoLLM
    materialidade_estimada: Literal["baixa", "media", "alta"]
    horizonte: Literal["curto", "medio", "longo"]
    resumo_1_linha: str = Field(min_length=1, max_length=300)
    confianca: float = Field(ge=0, le=1)

    @field_validator("tickers")
    @classmethod
    def _maiusculas(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().upper() for t in v if t.strip()})

    def ancorar(self, universo: set[str], citados: set[str]) -> Extracao:
        """Mantém só tickers do universo; se o texto citou empresas pelos apelidos, eles entram.

        É a última linha contra alucinação: um ticker que não é do universo nunca passa.
        """
        tickers = sorted((set(self.tickers) & universo) | citados)
        return self.model_copy(update={"tickers": tickers})
