from datetime import UTC, date, datetime

from nicho.briefing import build_briefing


def _briefing(**over):  # type: ignore[no-untyped-def]
    base = dict(
        dia=date(2026, 10, 30),
        retornos={"^BVSP": -0.0075, "VALE3": 0.03, "PETR4": -0.02, "ITUB4": 0.01},
        ativos={t: {"nome": t, "setor": "x"} for t in ("VALE3", "PETR4", "ITUB4")},
        indice="^BVSP",
        anomalias=[{"ticker": "PETR4", "descricao": "retorno atípico", "severidade": "alta"}],
        historias=[
            {
                "titulo": "Vale sobe com minério",
                "tickers": ["VALE3"],
                "score": 71.4,
                "itens": [
                    {"titulo": "A", "link": "https://n/a", "origem": "X", "data": "2026-10-30"},
                    {"titulo": "B", "link": "https://n/b", "origem": "Y", "data": "2026-10-30"},
                ],
            }
        ],
        documentos=[
            {
                "ticker": "PETR4",
                "titulo": "Fato Relevante: acordo",
                "link": "https://cvm/1",
                "data": "2026-10-29",
            }
        ],
        macro={"selic": 13.75, "ipca": 0.82, "ipca_mes": date(2026, 9, 1), "ptax": 5.4212},
        gerado_em=datetime(2026, 10, 31, 12, tzinfo=UTC),
    )
    base.update(over)
    return build_briefing(**base)


def test_toda_afirmacao_cita_fonte_existente() -> None:
    b = _briefing()
    ns = {f["n"] for f in b["fontes"]}
    for s in b["secoes"]:
        for item in s["itens"]:
            assert item["refs"], item["texto"]
            assert set(item["refs"]) <= ns
    assert [s["id"] for s in b["secoes"]] == ["mercado", "macro", "noticias", "cvm", "anomalias"]


def test_numeros_em_pt_br_e_movers_ordenados() -> None:
    b = _briefing()
    mercado = [i["texto"] for i in b["secoes"][0]["itens"]]
    assert mercado[0] == "Ibovespa −0,75% no pregão de 30/10/2026."
    assert mercado[1] == "Maiores altas: VALE3 +3,00%; ITUB4 +1,00%."
    assert mercado[2] == "Maiores baixas: PETR4 −2,00%."
    assert "Selic meta em 13,75% ao ano." in [i["texto"] for i in b["secoes"][1]["itens"]]


def test_fonte_repetida_reaproveita_numero_e_secao_vazia_avisa() -> None:
    b = _briefing(anomalias=[], documentos=[])
    sgs = [f for f in b["fontes"] if f["origem"] == "Banco Central do Brasil"]
    assert len(sgs) == 1
    assert b["secoes"][3]["itens"] == [
        {"texto": "Não encontrei dados para esta seção.", "refs": []}
    ]
    assert "recomendação" in b["aviso"]
