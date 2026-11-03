"""Propagação de choque (prompt §5.6, item 3) com PageRank personalizado.

Dado um nó-semente (empresa, setor ou acionista), o PageRank personalizado mede a probabilidade
estacionária de um passeio aleatório que sempre recomeça na semente: quanto mais caminhos fortes
levam de lá até uma empresa, maior a exposição dela ao choque. O grafo de propagação combina:

* correlação de retornos (ρ do snapshot mais recente, acima do limiar);
* coocorrência em notícias (com decaimento);
* controle, participação, administradores em comum e setor.

Cada resultado traz o caminho mais forte até a semente, para o ranking ser explicável.
Ressalva: é uma medida de **exposição por conexão**, não uma previsão de preço.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Any

import networkx as nx

from nicho.config import ChoqueCfg

ROTULO_RELACAO = {
    "correlacao": "correlação",
    "CO_MENCIONADA_COM": "citadas juntas",
    "CONTROLA": "controle",
    "PARTICIPA": "participação",
    "ADMINISTRA": "administrador em comum",
    "PERTENCE_A": "mesmo setor",
}


def grafo_propagacao(
    conhecimento: nx.MultiGraph,
    correlacoes: list[tuple[str, str, float]],
    cfg: ChoqueCfg,
) -> nx.Graph:
    """Grafo simples ponderado; ligações paralelas somam peso e guardam o motivo mais forte."""
    p = cfg.pesos
    peso_por_rel = {
        "CO_MENCIONADA_COM": p.co_mencao,
        "CONTROLA": p.controle,
        "PARTICIPA": p.participacao,
        "ADMINISTRA": p.administra,
        "PERTENCE_A": p.setor,
    }
    g = nx.Graph()
    for n, d in conhecimento.nodes(data=True):
        if d.get("tipo") in ("Empresa", "Setor", "Acionista", "Pessoa"):
            g.add_node(n, **d)

    max_com = max(
        (
            d["peso"]
            for _, _, d in conhecimento.edges(data=True)
            if d["relacao"] == "CO_MENCIONADA_COM"
        ),
        default=1.0,
    )

    def somar(a: str, b: str, w: float, motivo: str, detalhe: str) -> None:
        if w <= 0 or a not in g or b not in g:
            return
        if g.has_edge(a, b):
            e = g[a][b]
            e["weight"] += w
            if w > e["w_motivo"]:
                e.update(motivo=motivo, detalhe=detalhe, w_motivo=w)
        else:
            g.add_edge(a, b, weight=w, motivo=motivo, detalhe=detalhe, w_motivo=w)

    for a, b, d in conhecimento.edges(data=True):
        rel = d["relacao"]
        if rel not in peso_por_rel:
            continue
        w = peso_por_rel[rel]
        detalhe = ""
        if rel == "CO_MENCIONADA_COM":
            w *= d["peso"] / max_com
        elif rel == "PARTICIPA":
            w *= min(float(d.get("percentual", 0)) / 20.0, 1.0)
            detalhe = f"{d.get('percentual', 0):.1f}%".replace(".", ",")
        elif rel == "ADMINISTRA":
            detalhe = str(d.get("cargo", ""))
        somar(a, b, w, rel, detalhe)
    for a, b, rho in correlacoes:
        somar(
            f"empresa:{a}",
            f"empresa:{b}",
            p.correlacao * rho,
            "correlacao",
            f"ρ = {rho:.2f}".replace(".", ","),
        )
    return g


@dataclass(frozen=True)
class Impacto:
    no: str
    rotulo: str
    impacto: float  # 0 a 100, relativo ao mais exposto
    caminho: list[dict[str, str]]


def propagar(g: nx.Graph, semente: str, cfg: ChoqueCfg) -> list[Impacto]:
    if semente not in g or g.degree(semente) == 0:
        return []
    ppr = nx.pagerank(g, alpha=cfg.alpha, personalization={semente: 1.0}, weight="weight")
    empresas = [
        (n, v) for n, v in ppr.items() if n != semente and g.nodes[n].get("tipo") == "Empresa"
    ]
    empresas.sort(key=lambda x: -x[1])
    top = empresas[: cfg.top]
    if not top:
        return []
    maximo = top[0][1]
    # Caminho mais forte = menor soma de 1/peso.
    dist = {(a, b): 1.0 / d["weight"] for a, b, d in g.edges(data=True)}
    for (a, b), v in list(dist.items()):
        g[a][b]["custo"] = v
    out = []
    for n, v in top:
        try:
            nos = nx.shortest_path(g, semente, n, weight="custo")
        except nx.NetworkXNoPath:
            nos = [semente, n]
        passos = []
        for a, b in itertools.pairwise(nos):
            e = g[a][b]
            passos.append(
                {
                    "de": g.nodes[a].get("rotulo", a),
                    "para": g.nodes[b].get("rotulo", b),
                    "motivo": ROTULO_RELACAO.get(e["motivo"], e["motivo"]),
                    "detalhe": e.get("detalhe", ""),
                }
            )
        out.append(Impacto(n, g.nodes[n].get("rotulo", n), round(100 * v / maximo, 1), passos))
    return out


def sementes(g: nx.Graph) -> list[str]:
    """Empresas, setores e acionistas ligados a 2+ empresas (choques com interpretação clara)."""
    out = []
    for n, d in g.nodes(data=True):
        t = d.get("tipo")
        if t in ("Empresa", "Setor"):
            out.append(n)
        elif t == "Acionista":
            empresas = [m for m in g.neighbors(n) if g.nodes[m].get("tipo") == "Empresa"]
            if len(empresas) >= 2:
                out.append(n)
    return sorted(out)


def exportar(g: nx.Graph, resultados: dict[str, list[Impacto]]) -> dict[str, Any]:
    return {
        "sementes": [
            {"id": s, "rotulo": g.nodes[s].get("rotulo", s), "tipo": g.nodes[s].get("tipo")}
            for s in resultados
        ],
        "rankings": {
            s: [
                {"id": i.no, "rotulo": i.rotulo, "impacto": i.impacto, "caminho": i.caminho}
                for i in imps
            ]
            for s, imps in resultados.items()
        },
    }
