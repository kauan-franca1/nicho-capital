"""Schemas Pydantic e carregamento dos YAMLs de `config/`."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from nicho.paths import config_dir

# 4 caracteres de raiz (letra inicial; pode conter dígito, ex.: B3SA3) + 1-2 dígitos de classe.
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{3}\d{1,2}$")

TipoEvento = Literal[
    "resultado",
    "dividendos",
    "M&A",
    "guidance",
    "regulatório",
    "rating",
    "troca_de_gestao",
    "emissao",
    "recompra",
    "judicial",
    "macro",
    "outro",
]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# ------------------------------------------------------------------ universe.yaml
class Ativo(_Base):
    ticker: str
    nome: str
    setor: str
    apelidos: list[str] = Field(min_length=1)
    # Só quando o FCA não resolve o ticker (código inválido no cadastro da CVM).
    cnpj: str | None = Field(default=None, pattern=r"^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$")

    @field_validator("ticker")
    @classmethod
    def _ticker_b3(cls, v: str) -> str:
        if not TICKER_RE.match(v):
            raise ValueError(f"ticker fora do padrão B3: {v!r}")
        return v

    @property
    def yahoo_symbol(self) -> str:
        return f"{self.ticker}.SA"


class Indice(_Base):
    ticker: str
    nome: str


class Universe(_Base):
    versao: int
    indice: Indice
    ativos: list[Ativo] = Field(min_length=1)
    setores: dict[str, str]

    @model_validator(mode="after")
    def _consistente(self) -> Universe:
        tickers = [a.ticker for a in self.ativos]
        repetidos = {t for t in tickers if tickers.count(t) > 1}
        if repetidos:
            raise ValueError(f"tickers repetidos: {sorted(repetidos)}")
        sem_setor = {a.setor for a in self.ativos} - self.setores.keys()
        if sem_setor:
            raise ValueError(f"setores não declarados em 'setores': {sorted(sem_setor)}")
        return self


# ------------------------------------------------------------------ sources.yaml
class FonteRss(_Base):
    id: str
    nome: str
    url: HttpUrl


class GoogleNews(_Base):
    url_template: str
    min_intervalo_segundos: float = Field(gt=0)

    @field_validator("url_template")
    @classmethod
    def _tem_query(cls, v: str) -> str:
        if "{query}" not in v:
            raise ValueError("url_template precisa conter {query}")
        return v


class Gdelt(_Base):
    url: HttpUrl
    mode: str
    format: str
    maxrecords: int = Field(ge=1, le=250)
    query_sufixo: str = ""
    min_intervalo_segundos: float = Field(ge=5)


class Sources(_Base):
    versao: int
    user_agent_env: str
    rss: list[FonteRss]
    google_news: GoogleNews
    gdelt: Gdelt

    @model_validator(mode="after")
    def _ids_unicos(self) -> Sources:
        ids = [f.id for f in self.rss]
        if len(ids) != len(set(ids)):
            raise ValueError("ids de RSS repetidos")
        return self


# ------------------------------------------------------------------ scoring.yaml
class Pesos(_Base):
    materialidade: float = Field(ge=0)
    sentimento_intensidade: float = Field(ge=0)
    fontes_independentes: float = Field(ge=0)
    reacao_mercado: float = Field(ge=0)
    centralidade_grafo: float = Field(ge=0)
    novidade: float = Field(ge=0)
    recencia: float = Field(ge=0)

    @model_validator(mode="after")
    def _soma_um(self) -> Pesos:
        total = sum(self.model_dump().values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise ValueError(f"os pesos devem somar 1 (somam {total:.4f})")
        return self


class Recencia(_Base):
    meia_vida_horas: float = Field(gt=0)


class Scoring(_Base):
    versao: int
    pesos: Pesos
    recencia: Recencia
    materialidade_por_tipo: dict[TipoEvento, float]

    @field_validator("materialidade_por_tipo")
    @classmethod
    def _entre_0_e_1(cls, v: dict[TipoEvento, float]) -> dict[TipoEvento, float]:
        fora = {k: x for k, x in v.items() if not 0 <= x <= 1}
        if fora:
            raise ValueError(f"materialidade fora de [0, 1]: {fora}")
        return v


# ------------------------------------------------------------------ llm.yaml
NomeProvedor = Literal["gemini", "groq", "ollama"]


class Cota(_Base):
    rpm: int = Field(ge=0, description="0 = sem limite")
    rpd: int = Field(ge=0, description="0 = sem limite")


class Provedor(_Base):
    env_chave: str | None = None
    env_url: str | None = None
    modelo_agente: str
    modelo_extracao: str
    cota: Cota


class Llm(_Base):
    versao: int
    cadeia: list[NomeProvedor] = Field(min_length=1)
    provedores: dict[NomeProvedor, Provedor]

    @model_validator(mode="after")
    def _cadeia_declarada(self) -> Llm:
        faltando = set(self.cadeia) - self.provedores.keys()
        if faltando:
            raise ValueError(f"provedores da cadeia sem configuração: {sorted(faltando)}")
        return self


# ------------------------------------------------------------------ macro.yaml
class SerieSgs(_Base):
    codigo: int = Field(gt=0)
    slug: str = Field(pattern=r"^[a-z0-9_]+$")
    nome: str
    unidade: str
    periodicidade: Literal["diaria", "mensal"]


class Macro(_Base):
    versao: int
    anos_historico: int = Field(ge=1, le=30)
    series: list[SerieSgs] = Field(min_length=1)

    @model_validator(mode="after")
    def _unicos(self) -> Macro:
        for campo in ("codigo", "slug"):
            valores = [getattr(s, campo) for s in self.series]
            if len(valores) != len(set(valores)):
                raise ValueError(f"{campo} repetido nas séries do SGS")
        return self


# ------------------------------------------------------------------ stats.yaml
Severidade = Literal["baixa", "media", "alta"]


class Limiares(_Base):
    baixa: float = Field(gt=0)
    media: float = Field(gt=0)
    alta: float = Field(gt=0)

    @model_validator(mode="after")
    def _crescentes(self) -> Limiares:
        if not self.baixa < self.media < self.alta:
            raise ValueError("limiares precisam ser crescentes: baixa < media < alta")
        return self

    def severidade(self, valor: float) -> Severidade | None:
        v = abs(valor)
        if v >= self.alta:
            return "alta"
        if v >= self.media:
            return "media"
        if v >= self.baixa:
            return "baixa"
        return None


class AnomaliasCfg(_Base):
    janela: int = Field(ge=10)
    min_obs: int = Field(ge=5)
    limiares: Limiares
    volume_so_alta: bool
    pregoes_recentes: int = Field(ge=1)

    @model_validator(mode="after")
    def _min_obs(self) -> AnomaliasCfg:
        if self.min_obs > self.janela:
            raise ValueError("min_obs não pode ser maior que a janela")
        return self


class ChangePointsCfg(_Base):
    penalidade_fator: float = Field(gt=0)
    tamanho_minimo: int = Field(ge=2)
    salto: int = Field(ge=1, le=20)
    limiares_razao: Limiares


class GarchCfg(_Base):
    pregoes: int = Field(ge=250)
    distribuicao: Literal["normal", "t"]
    horizonte_previsao: int = Field(ge=1, le=30)


class EventStudyCfg(_Base):
    estimacao: tuple[int, int]
    min_obs_estimacao: int = Field(ge=30)
    janelas: list[tuple[int, int]] = Field(min_length=1)
    nivel_confianca: float = Field(gt=0.5, lt=1)
    choque_mercado_severidade: Severidade

    @model_validator(mode="after")
    def _sem_sobreposicao(self) -> EventStudyCfg:
        ini, fim = self.estimacao
        if not ini < fim < 0:
            raise ValueError("a janela de estimação precisa terminar antes do evento")
        for a, b in self.janelas:
            if a > b:
                raise ValueError(f"janela de evento inválida: [{a}, {b}]")
            if a <= fim:
                raise ValueError("janela de evento sobrepõe a janela de estimação")
        return self


class Stats(_Base):
    versao: int
    anomalias: AnomaliasCfg
    change_points: ChangePointsCfg
    garch: GarchCfg
    event_study: EventStudyCfg


# ------------------------------------------------------------------ nlp.yaml
class ColetaCfg(_Base):
    dias: int = Field(ge=1, le=90)
    google_news_por_empresa: bool
    gdelt_empresas_por_consulta: int = Field(ge=1, le=20)
    resumo_max_caracteres: int = Field(ge=100)


class CvmCfg(_Base):
    categorias: list[str] = Field(min_length=1)
    dias: int = Field(ge=1, le=365)
    max_pdfs_por_execucao: int = Field(ge=0)
    max_caracteres_texto: int = Field(ge=500)
    intervalo_download_segundos: float = Field(ge=0.5)


class EmbeddingsCfg(_Base):
    modelo: str
    dimensao: int
    lote: int = Field(ge=1)


class DedupeCfg(_Base):
    limiar_cosseno: float = Field(gt=0, lt=1)
    limiar_mesma_empresa: float = Field(gt=0, lt=1)
    janela_horas: int = Field(ge=1)


class SentimentoCfg(_Base):
    modelo: str
    lote: int = Field(ge=1)


class ExtracaoCfg(_Base):
    prompt_versao: str = Field(pattern=r"^[a-z_]+/v\d+$")
    max_itens_por_execucao: int = Field(ge=0)
    max_caracteres_entrada: int = Field(ge=200)
    temperatura: float = Field(ge=0, le=1)


class NovidadeCfg(_Base):
    dias_referencia: int = Field(ge=1)


class NlpEventStudyCfg(_Base):
    materialidade_minima: Literal["baixa", "media", "alta"]


class Nlp(_Base):
    versao: int
    coleta: ColetaCfg
    cvm: CvmCfg
    embeddings: EmbeddingsCfg
    dedupe: DedupeCfg
    sentimento: SentimentoCfg
    extracao: ExtracaoCfg
    novidade: NovidadeCfg
    event_study: NlpEventStudyCfg


# ------------------------------------------------------------------ graphs.yaml
class CorrelacaoCfg(_Base):
    janela_dias: int = Field(ge=20)
    min_obs: int = Field(ge=10)
    meses: int = Field(ge=1, le=60)
    rho_minimo: float = Field(ge=0, lt=1)
    semente_layout: int


class ConhecimentoCfg(_Base):
    participacao_minima: float = Field(gt=0, le=100)
    cargos_destaque: list[str]
    score_minimo_evento: float = Field(ge=0, le=100)
    max_eventos: int = Field(ge=0)
    meia_vida_comencao_dias: float = Field(gt=0)


class PesosChoque(_Base):
    correlacao: float = Field(ge=0)
    co_mencao: float = Field(ge=0)
    controle: float = Field(ge=0)
    participacao: float = Field(ge=0)
    administra: float = Field(ge=0)
    setor: float = Field(ge=0)


class ChoqueCfg(_Base):
    alpha: float = Field(gt=0, lt=1)
    pesos: PesosChoque
    top: int = Field(ge=1)


class Graphs(_Base):
    versao: int
    correlacao: CorrelacaoCfg
    conhecimento: ConhecimentoCfg
    choque: ChoqueCfg


# ------------------------------------------------------------------ carregamento
class Config(_Base):
    universe: Universe
    sources: Sources
    scoring: Scoring
    llm: Llm
    macro: Macro
    stats: Stats
    nlp: Nlp
    graphs: Graphs


def _ler_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: esperado um mapeamento no topo do arquivo")
    return data


def load_config(directory: Path | None = None) -> Config:
    d = directory or config_dir()
    return Config(
        universe=Universe.model_validate(_ler_yaml(d / "universe.yaml")),
        sources=Sources.model_validate(_ler_yaml(d / "sources.yaml")),
        scoring=Scoring.model_validate(_ler_yaml(d / "scoring.yaml")),
        llm=Llm.model_validate(_ler_yaml(d / "llm.yaml")),
        macro=Macro.model_validate(_ler_yaml(d / "macro.yaml")),
        stats=Stats.model_validate(_ler_yaml(d / "stats.yaml")),
        nlp=Nlp.model_validate(_ler_yaml(d / "nlp.yaml")),
        graphs=Graphs.model_validate(_ler_yaml(d / "graphs.yaml")),
    )
