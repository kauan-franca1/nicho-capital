import io
import zipfile
from datetime import date

import pytest

from nicho.config import load_config
from nicho.ingest.cvm import filtrar_ipe, ler_csv_zip, mapa_cnpj, texto_pdf

UNIVERSE = load_config().universe
PETRO = "33.000.167/0001-01"

FCA = [
    {
        "CNPJ_Companhia": PETRO,
        "Codigo_Negociacao": "PETR3",
        "Versao": "1",
        "Data_Fim_Negociacao": "",
    },
    {
        "CNPJ_Companhia": PETRO,
        "Codigo_Negociacao": "PETR4",
        "Versao": "1",
        "Data_Fim_Negociacao": "",
    },
    {"CNPJ_Companhia": "1", "Codigo_Negociacao": "VALE3", "Versao": "1", "Data_Fim_Negociacao": ""},
    {"CNPJ_Companhia": "2", "Codigo_Negociacao": "VALE3", "Versao": "3", "Data_Fim_Negociacao": ""},
    {
        "CNPJ_Companhia": "9",
        "Codigo_Negociacao": "WEGE3",
        "Versao": "1",
        "Data_Fim_Negociacao": "2020-01-01",
    },
]


def test_mapa_cnpj_usa_primeiro_ticker_do_universo_e_versao_recente() -> None:
    m = mapa_cnpj(FCA, UNIVERSE)
    assert m[PETRO] == "PETR4"  # PETR4 vem antes de PETR3 em universe.yaml
    assert m["2"] == "VALE3" and "1" not in m  # versão 3 substitui a 1
    assert "9" not in m  # negociação encerrada


def _ipe(categoria: str, entrega: str, cnpj: str = PETRO) -> dict[str, str]:
    return {
        "CNPJ_Companhia": cnpj,
        "Categoria": categoria,
        "Tipo": "",
        "Especie": "",
        "Assunto": "Assunto",
        "Data_Entrega": entrega,
        "Data_Referencia": entrega,
        "Protocolo_Entrega": "P1",
        "Versao": "2",
        "Link_Download": "https://rad/x",
    }


def test_filtrar_ipe_por_categoria_empresa_e_data() -> None:
    linhas = [
        _ipe("Fato Relevante", "2026-10-13"),
        _ipe("Assembleia", "2026-10-13"),
        _ipe("Fato Relevante", "2026-01-01"),
        _ipe("Fato Relevante", "2026-10-13", cnpj="0"),
    ]
    (f,) = filtrar_ipe(linhas, {PETRO: "PETR4"}, ["Fato Relevante"], date(2026, 9, 1))
    assert f.ticker == "PETR4" and f.versao == 2
    assert f.data_entrega.date() == date(2026, 10, 13) and f.data_entrega.hour == 12


def test_ler_csv_zip_latin1() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "ipe_cia_aberta_2026.csv", "Categoria;Assunto\nFato Relevante;Cisão\n".encode("latin-1")
        )
    assert ler_csv_zip(buf.getvalue(), "ipe_cia_aberta") == [
        {"Categoria": "Fato Relevante", "Assunto": "Cisão"}
    ]


def test_texto_pdf() -> None:
    import pymupdf

    doc = pymupdf.open()
    for i in range(3):
        doc.new_page().insert_text((72, 72), f"Pagina {i} Fato Relevante")
    conteudo = doc.tobytes()
    texto = texto_pdf(conteudo, 30)
    assert texto.startswith("Pagina 0 Fato Relevante") and len(texto) <= 30
    with pytest.raises(ValueError, match="não é um PDF"):
        texto_pdf(b"<html>erro</html>", 100)
