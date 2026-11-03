import csv
import io
import math
import zipfile
from datetime import UTC, date, datetime, timedelta

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from nicho.config import load_config
from nicho.graphs import correlation, knowledge, shock

CFG = load_config()


# ------------------------------------------------------------------ correlação
def _retornos_em_blocos(seed: int = 0, n: int = 120) -> pd.DataFrame:
    """Dois blocos de 4 ativos: cada bloco segue um fator comum; blocos independentes."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2026-05-01", periods=n)
    f1, f2 = rng.normal(0, 0.02, n), rng.normal(0, 0.02, n)
    cols = {}
    for i in range(4):
        cols[f"AAA{i}3"] = f1 + rng.normal(0, 0.006, n)
        cols[f"BBB{i}3"] = f2 + rng.normal(0, 0.006, n)
    return pd.DataFrame(cols, index=idx)


def test_distancia_de_mantegna() -> None:
    assert correlation.distancia_mantegna(1.0) == 0.0
    assert correlation.distancia_mantegna(0.0) == pytest.approx(math.sqrt(2))
    assert correlation.distancia_mantegna(-1.0) == pytest.approx(2.0)


def test_mst_tem_n_menos_1_arestas_e_liga_blocos_uma_vez() -> None:
    corr = correlation.matriz_correlacao(_retornos_em_blocos(), 40)
    arvore = correlation.mst(corr)
    assert arvore.number_of_edges() == arvore.number_of_nodes() - 1 == 7
    assert nx.is_tree(arvore)
    entre_blocos = [(a, b) for a, b in arvore.edges if a[:3] != b[:3]]
    assert len(entre_blocos) == 1


def test_louvain_separa_os_blocos() -> None:
    corr = correlation.matriz_correlacao(_retornos_em_blocos(), 40)
    com = correlation.comunidades(correlation.grafo_completo(corr, 0.3), semente=42)
    assert len({com[f"AAA{i}3"] for i in range(4)}) == 1
    assert len({com[f"BBB{i}3"] for i in range(4)}) == 1
    assert com["AAA03"] != com["BBB03"]


def test_pares_respeita_minimo_e_nan() -> None:
    corr = pd.DataFrame(
        [[1, 0.5, np.nan], [0.5, 1, 0.1], [np.nan, 0.1, 1]], index=list("abc"), columns=list("abc")
    )
    assert correlation.pares(corr) == [("a", "b", 0.5), ("b", "c", 0.1)]
    assert correlation.pares(corr, 0.3) == [("a", "b", 0.5)]


def test_snapshot_completo_e_layout_estavel() -> None:
    r = _retornos_em_blocos()
    setores = {c: "x" for c in r.columns}
    ref = r.index[-1].date()
    s1 = correlation.snapshot(r, ref, 90, 40, 0.3, 42, setores)
    assert s1 is not None and len(s1.nos) == 8 and len(s1.arestas) == 7
    assert s1.metricas["n_comunidades"] == 2
    anterior = {n["id"]: (n["x"], n["y"]) for n in s1.nos}
    s2 = correlation.snapshot(r, ref, 90, 40, 0.3, 42, setores, anterior)
    assert s2 is not None
    deslocamento = max(math.dist(anterior[n["id"]], (n["x"], n["y"])) for n in s2.nos)
    assert deslocamento < 0.5  # parte das posições anteriores: a animação não "pula"


def test_datas_de_snapshot_sao_fins_de_mes_mais_o_ultimo_pregao() -> None:
    pregoes = pd.bdate_range("2026-07-01", "2026-10-28")
    datas = correlation.datas_snapshot(pregoes, meses=3)
    assert datas == [date(2026, 8, 31), date(2026, 9, 30), date(2026, 10, 28)]


# ------------------------------------------------------------------ conhecimento
def _fre_zip() -> bytes:
    adm_cols = [
        "CNPJ_Companhia",
        "ID_Documento",
        "Orgao_Administracao",
        "Nome",
        "CPF",
        "Cargo_Eletivo_Ocupado",
    ]
    adm = [
        [
            "1",
            "10",
            "Conselho de Administração",
            "MARIA SILVA",
            "111",
            "20 - Presidente do Conselho de Administração",
        ],
        ["1", "10", "Conselho Fiscal", "JOAO FISCAL", "222", "45 - C.F.(Efetivo)"],
        ["1", "9", "Diretoria", "VERSAO ANTIGA", "333", "10 - Diretor Presidente"],
        [
            "2",
            "20",
            "Conselho de Administração",
            "Maria Silva",
            "111",
            "22 - Conselho de Administração (Efetivo)",
        ],
        ["2", "20", "Diretoria", "PEDRO SOZINHO", "444", "19 - Outros Diretores"],
    ]
    pos_cols = [
        "CNPJ_Companhia",
        "ID_Documento",
        "Acionista",
        "Tipo_Pessoa_Acionista",
        "ID_Acionista_Relacionado",
        "Percentual_Total_Acoes_Circulacao",
        "Acionista_Controlador",
    ]
    pos = [
        ["1", "10", "UNIÃO FEDERAL", "PJ", "", "50.0", "S"],
        ["1", "10", "Ações Tesouraria", "", "", "1.0", "N"],
        ["2", "20", "BLACKROCK, INC.", "PJ", "", "6.2", "N"],
        ["2", "20", "FAMILIAR PEQUENO", "PF", "", "0.4", "S"],
        ["2", "20", "SUB-HOLDING", "PJ", "99", "30.0", "N"],
    ]

    def para_csv(cols: list[str], linhas: list[list[str]]) -> bytes:
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(cols)
        w.writerows(linhas)
        return buf.getvalue().encode("latin-1")

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            "fre_cia_aberta_administrador_membro_conselho_fiscal_2026.csv", para_csv(adm_cols, adm)
        )
        z.writestr("fre_cia_aberta_posicao_acionaria_2026.csv", para_csv(pos_cols, pos))
    return out.getvalue()


def test_ler_fre_filtra_versao_conselho_fiscal_e_cadeia() -> None:
    admins, acionistas = knowledge.ler_fre(_fre_zip(), {"1", "2"})
    nomes = {a.nome for a in admins}
    assert "JOAO FISCAL" not in nomes and "VERSAO ANTIGA" not in nomes
    assert next(a for a in admins if a.nome == "MARIA SILVA").cargo.startswith(
        "Presidente do Conselho"
    )
    assert {a.nome for a in acionistas} == {"UNIÃO FEDERAL", "BLACKROCK, INC.", "FAMILIAR PEQUENO"}
    assert not hasattr(admins[0], "cpf")  # LGPD: CPF nunca é lido


def _grafo() -> knowledge.GrafoConhecimento:
    admins, acionistas = knowledge.ler_fre(_fre_zip(), {"1", "2"})
    agora = datetime(2026, 10, 31, tzinfo=UTC)
    historias = [
        knowledge.HistoriaRef(1, "Vale e Petrobras", ("VALE3", "PETR4"), 80, agora),
        knowledge.HistoriaRef(2, "De novo", ("VALE3", "PETR4"), 30, agora - timedelta(days=7)),
    ]
    return knowledge.construir(
        CFG.universe,
        {"1": "PETR4", "2": "VALE3"},
        admins,
        acionistas,
        historias,
        CFG.graphs.conhecimento,
        agora,
    )


def test_construir_conhecimento() -> None:
    k = _grafo()
    g = k.g
    assert "pessoa:MARIA-SILVA" in g  # interlock: está em duas empresas
    assert "pessoa:PEDRO-SOZINHO" not in g  # uma empresa só e cargo comum
    assert g.has_edge("acionista:UNIAO-FEDERAL", "empresa:PETR4", key="CONTROLA")
    assert g.has_edge("acionista:BLACKROCK-INC", "empresa:VALE3", key="PARTICIPA")
    assert "acionista:FAMILIAR-PEQUENO" not in g  # controlador com 0,4%: abaixo do mínimo
    w = g.get_edge_data("empresa:PETR4", "empresa:VALE3", key="CO_MENCIONADA_COM")["peso"]
    assert w == pytest.approx(1.0 + 0.5)  # hoje + uma meia-vida atrás
    assert g.has_edge("empresa:VALE3", "evento:1") and "evento:2" not in g  # score abaixo de 60
    assert g.has_edge("empresa:VALE3", "setor:mineracao_siderurgia", key="PERTENCE_A")


def test_export_tem_direcao_semantica() -> None:
    k = _grafo()
    out = knowledge.exportar(k, knowledge.layout(k, 42))
    adm = [e for e in out["arestas"] if e["relacao"] in ("ADMINISTRA", "CONTROLA", "PARTICIPA")]
    assert adm and all(
        not e["source"].startswith("empresa:") and e["target"].startswith("empresa:") for e in adm
    )
    setor = [e for e in out["arestas"] if e["relacao"] == "PERTENCE_A"]
    assert all(e["source"].startswith("empresa:") for e in setor)


# ------------------------------------------------------------------ choque
def test_propagacao_ranqueia_e_explica() -> None:
    k = _grafo()
    corr = [("VALE3", "GGBR4", 0.8), ("GGBR4", "USIM5", 0.7), ("VALE3", "ITUB4", 0.31)]
    g = shock.grafo_propagacao(k.g, corr, CFG.graphs.choque)
    r = shock.propagar(g, "empresa:VALE3", CFG.graphs.choque)
    nomes = [i.no for i in r]
    assert nomes[0] == "empresa:GGBR4" and r[0].impacto == 100.0
    assert nomes.index("empresa:GGBR4") < nomes.index("empresa:ITUB4")
    usim = next(i for i in r if i.no == "empresa:USIM5")
    assert [p["motivo"] for p in usim.caminho][:1] in (["correlação"], ["mesmo setor"])
    assert all(0 < i.impacto <= 100 for i in r)


def test_sementes_e_semente_isolada() -> None:
    k = _grafo()
    g = shock.grafo_propagacao(k.g, [], CFG.graphs.choque)
    s = shock.sementes(g)
    assert "empresa:PETR4" in s and "setor:financeiro" in s
    assert "acionista:BLACKROCK-INC" not in s  # só uma empresa no exemplo
    g.add_node("empresa:SOLTA", tipo="Empresa", rotulo="Solta")
    assert shock.propagar(g, "empresa:SOLTA", CFG.graphs.choque) == []
