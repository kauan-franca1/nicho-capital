import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from nicho.export import arquivo_ticker, build_snapshot, write_snapshot

SP = ZoneInfo("America/Sao_Paulo")


def _snapshot() -> dict[str, object]:
    return build_snapshot(
        ativos=[
            ("^BVSP", "Ibovespa", "indice", True),
            ("PETR4", "Petrobras", "petroleo_gas", False),
        ],
        precos=[
            (
                "PETR4",
                date(2026, 10, 30),
                Decimal("52.45"),
                53.66,
                52.36,
                Decimal("52.709999"),
                52.709999,
                61743200,
                "yfinance",
            ),
            ("PETR4", date(2026, 10, 29), 52.05, 53.03, 51.75, 52.2, 52.2, 51969000, "yfinance"),
            ("^BVSP", date(2026, 10, 30), None, None, None, 131000.12345, None, 0, "yfinance"),
        ],
        intraday=[("PETR4", datetime(2026, 10, 30, 16, 45, tzinfo=SP), 52.71, 2000)],
        macro_series=[(1, "ptax_venda", "Dólar PTAX — venda", "R$/US$", "diaria")],
        macro_obs=[(1, date(2026, 10, 30), Decimal("5.4212"))],
        ultima_atualizacao=datetime(2026, 10, 30, 21, 40, tzinfo=UTC),
        gerado_em=datetime(2026, 10, 31, 12, 0, tzinfo=UTC),
    )


def test_nome_de_arquivo_do_indice() -> None:
    assert arquivo_ticker("^BVSP") == "BVSP.json"
    assert arquivo_ticker("PETR4") == "PETR4.json"


def test_precos_ordenados_e_arredondados() -> None:
    files = _snapshot()
    petr = files["precos/PETR4.json"]
    assert isinstance(petr, dict)
    assert [linha[0] for linha in petr["linhas"]] == ["2026-10-29", "2026-10-30"]
    assert petr["linhas"][-1][4] == 52.71  # Decimal e float viram float com 4 casas
    assert petr["colunas"][0] == "dia"


def test_meta_usa_ultimo_pregao_do_indice() -> None:
    meta = _snapshot()["meta.json"]
    assert meta == {
        "versao": 1,
        "gerado_em": "2026-10-31T12:00:00+00:00",
        "ultima_atualizacao": "2026-10-30T21:40:00+00:00",
        "ultimo_pregao": "2026-10-30",
    }


def test_intraday_e_macro() -> None:
    files = _snapshot()
    intra = files["intraday.json"]
    assert isinstance(intra, dict)
    assert intra["series"]["PETR4"] == [["2026-10-30T16:45:00-03:00", 52.71, 2000]]
    macro = files["macro.json"]
    assert isinstance(macro, dict)
    assert macro["series"][0]["observacoes"] == [["2026-10-30", 5.4212]]


def test_write_snapshot_preserva_readme_e_e_idempotente(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("doc", encoding="utf-8")
    (tmp_path / "precos").mkdir()
    (tmp_path / "precos" / "ANTIGO3.json").write_text("{}", encoding="utf-8")
    files = _snapshot()
    a = write_snapshot(files, tmp_path)
    b = write_snapshot(files, tmp_path)
    assert a == b
    assert (tmp_path / "README.md").read_text(encoding="utf-8") == "doc"
    assert not (tmp_path / "precos" / "ANTIGO3.json").exists()
    meta = json.loads((tmp_path / "meta.json").read_text(encoding="utf-8"))
    assert meta["ultimo_pregao"] == "2026-10-30"
