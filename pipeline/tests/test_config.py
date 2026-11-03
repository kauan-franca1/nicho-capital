from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from nicho.config import Pesos, Universe, load_config
from nicho.paths import config_dir


def test_config_do_repositorio_e_valida() -> None:
    cfg = load_config()
    assert cfg.universe.indice.ticker == "^BVSP"
    assert len(cfg.universe.ativos) >= 40
    assert cfg.llm.cadeia == ["gemini", "groq", "ollama"]


def test_yahoo_symbol_usa_sufixo_sa() -> None:
    ativo = load_config().universe.ativos[0]
    assert ativo.yahoo_symbol == f"{ativo.ticker}.SA"


def _universe_raw() -> dict[str, object]:
    with (config_dir() / "universe.yaml").open(encoding="utf-8") as f:
        data: dict[str, object] = yaml.safe_load(f)
    return data


def test_ticker_repetido_e_rejeitado() -> None:
    raw = _universe_raw()
    ativos = list(raw["ativos"])  # type: ignore[call-overload]
    raw["ativos"] = [*ativos, ativos[0]]
    with pytest.raises(ValidationError, match="repetidos"):
        Universe.model_validate(raw)


def test_setor_nao_declarado_e_rejeitado() -> None:
    raw = _universe_raw()
    raw["ativos"] = [{"ticker": "ABCD3", "nome": "X", "setor": "inexistente", "apelidos": ["X"]}]
    with pytest.raises(ValidationError, match="setores não declarados"):
        Universe.model_validate(raw)


@pytest.mark.parametrize("ticker", ["petr4", "PETR", "PETR4.SA", "^BVSP"])
def test_ticker_invalido_e_rejeitado(ticker: str) -> None:
    raw = _universe_raw()
    raw["ativos"] = [{"ticker": ticker, "nome": "X", "setor": "financeiro", "apelidos": ["X"]}]
    with pytest.raises(ValidationError):
        Universe.model_validate(raw)


def test_pesos_precisam_somar_um() -> None:
    with pytest.raises(ValidationError, match="somar 1"):
        Pesos(
            materialidade=0.5,
            sentimento_intensidade=0.5,
            fontes_independentes=0.5,
            reacao_mercado=0,
            centralidade_grafo=0,
            novidade=0,
            recencia=0,
        )


def test_gdelt_respeita_intervalo_minimo(tmp_path: Path) -> None:
    for nome in ("universe", "scoring", "llm", "macro", "stats", "nlp", "graphs"):
        (tmp_path / f"{nome}.yaml").write_text(
            (config_dir() / f"{nome}.yaml").read_text(encoding="utf-8"), encoding="utf-8"
        )
    sources = (config_dir() / "sources.yaml").read_text(encoding="utf-8")
    (tmp_path / "sources.yaml").write_text(
        sources.replace("min_intervalo_segundos: 5", "min_intervalo_segundos: 1"), encoding="utf-8"
    )
    with pytest.raises(ValidationError):
        load_config(tmp_path)
