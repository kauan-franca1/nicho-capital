"""Rede de correlação de ativos (prompt §5.6, item 1).

* Correlação de Pearson dos log-retornos numa janela móvel (dias corridos), com pares exigindo
  um mínimo de observações em comum.
* Distância de Mantegna: d = √(2·(1 − ρ)), uma métrica (0 para ρ = 1, 2 para ρ = −1).
* Minimum Spanning Tree (Kruskal) sobre as distâncias: o "esqueleto" do mercado com n − 1 arestas.
* Comunidades: Louvain no grafo completo de correlações positivas acima de um limiar.
* Centralidades: grau e intermediação na MST; autovetor no grafo completo ponderado por ρ.
* Layout: força dirigida na MST, inicializado pelo snapshot anterior para a animação ser estável.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import networkx as nx
import numpy as np
import pandas as pd


@dataclass
class Snapshot:
    referencia: date
    n_obs: int
    nos: list[dict[str, Any]] = field(default_factory=list)
    arestas: list[dict[str, Any]] = field(default_factory=list)
    metricas: dict[str, Any] = field(default_factory=dict)


def matriz_correlacao(retornos: pd.DataFrame, min_obs: int) -> pd.DataFrame:
    """Pearson par a par; pares com menos de `min_obs` observações em comum viram NaN."""
    return retornos.corr(method="pearson", min_periods=min_obs)


def distancia_mantegna(rho: float) -> float:
    return math.sqrt(max(0.0, 2.0 * (1.0 - rho)))


def pares(corr: pd.DataFrame, minimo: float | None = None) -> list[tuple[str, str, float]]:
    """Pares (a, b, ρ) do triângulo superior, sem NaN e, se pedido, com ρ ≥ `minimo`."""
    m = corr.to_numpy(dtype=float)
    cols = [str(c) for c in corr.columns]
    out = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            rho = float(m[i, j])
            if not np.isnan(rho) and (minimo is None or rho >= minimo):
                out.append((cols[i], cols[j], rho))
    return out


def mst(corr: pd.DataFrame) -> nx.Graph:
    g = nx.Graph()
    for a, b, rho in pares(corr):
        g.add_edge(a, b, rho=rho, weight=distancia_mantegna(rho))
    return nx.minimum_spanning_tree(g, weight="weight", algorithm="kruskal")


def grafo_completo(corr: pd.DataFrame, rho_minimo: float) -> nx.Graph:
    g = nx.Graph()
    g.add_nodes_from(str(c) for c in corr.columns)
    for a, b, rho in pares(corr, rho_minimo):
        g.add_edge(a, b, weight=rho)
    return g


def comunidades(g: nx.Graph, semente: int) -> dict[str, int]:
    """Louvain (networkx). Rótulos renumerados por tamanho: 0 = maior comunidade."""
    grupos = nx.community.louvain_communities(g, weight="weight", seed=semente)
    grupos = sorted(grupos, key=lambda c: (-len(c), min(c)))
    return {n: i for i, c in enumerate(grupos) for n in c}


def centralidades(arvore: nx.Graph, completo: nx.Graph) -> dict[str, dict[str, float]]:
    grau = nx.degree_centrality(arvore)
    inter = nx.betweenness_centrality(arvore, normalized=True)
    try:
        autovetor = nx.eigenvector_centrality_numpy(completo, weight="weight")
    except (nx.NetworkXException, ValueError, np.linalg.LinAlgError):
        autovetor = {}
    out: dict[str, dict[str, float]] = {}
    for n in arvore.nodes:
        out[n] = {
            "grau": round(grau.get(n, 0.0), 4),
            "intermediacao": round(inter.get(n, 0.0), 4),
            "autovetor": round(abs(autovetor.get(n, 0.0)), 4),
        }
    return out


def layout(
    arvore: nx.Graph, anterior: dict[str, tuple[float, float]] | None, semente: int
) -> dict[str, tuple[float, float]]:
    inicial = {n: anterior[n] for n in arvore.nodes if anterior and n in anterior} or None
    if inicial is not None and len(inicial) < arvore.number_of_nodes():
        inicial = None  # nó novo: recalcula do zero
    pos = nx.kamada_kawai_layout(arvore, pos=inicial, weight="weight")
    pos = nx.spring_layout(arvore, pos=pos, weight=None, iterations=30, seed=semente)
    return {n: (round(float(x), 4), round(float(y), 4)) for n, (x, y) in pos.items()}


def snapshot(
    retornos: pd.DataFrame,
    referencia: date,
    janela_dias: int,
    min_obs: int,
    rho_minimo: float,
    semente: int,
    setores: dict[str, str],
    anterior: dict[str, tuple[float, float]] | None = None,
) -> Snapshot | None:
    fim = pd.Timestamp(referencia)
    janela = retornos.loc[
        (retornos.index > fim - pd.Timedelta(days=janela_dias)) & (retornos.index <= fim)
    ]
    janela = janela.dropna(axis=1, thresh=min_obs)
    if janela.shape[1] < 3:
        return None
    corr = matriz_correlacao(janela, min_obs)
    arvore = mst(corr)
    completo = grafo_completo(corr, rho_minimo)
    com = comunidades(completo, semente)
    cent = centralidades(arvore, completo)
    pos = layout(arvore, anterior, semente)
    s = Snapshot(referencia, len(janela))
    for n in sorted(arvore.nodes):
        x, y = pos[n]
        s.nos.append(
            {
                "id": n,
                "setor": setores.get(n),
                "comunidade": com.get(n, -1),
                "x": x,
                "y": y,
                **cent[n],
            }
        )
    for a, b, d in sorted(arvore.edges(data=True)):
        s.arestas.append(
            {"source": a, "target": b, "rho": round(d["rho"], 4), "dist": round(d["weight"], 4)}
        )
    rhos = [rho for _, _, rho in pares(corr)]
    s.metricas = {
        "rho_medio": round(float(np.mean(rhos)), 4) if rhos else None,
        "n_comunidades": len(set(com.values())),
        "comprimento_mst": round(sum(d["weight"] for _, _, d in arvore.edges(data=True)), 4),
    }
    return s


def datas_snapshot(pregoes: pd.DatetimeIndex, meses: int) -> list[date]:
    """Último pregão de cada um dos últimos `meses` meses, mais o pregão mais recente."""
    if len(pregoes) == 0:
        return []
    serie = pd.Series(pregoes, index=pregoes)
    fins = serie.groupby(pregoes.to_period("M")).max()
    datas = [d.date() for d in fins.iloc[-meses:]]
    ultimo = pregoes[-1].date()
    if ultimo not in datas:
        datas.append(ultimo)
    return datas
