"""Grafo de conhecimento (prompt §5.6, item 2): empresas, setores, pessoas, acionistas e eventos.

Fontes: FRE da CVM (administradores e posição acionária) e as histórias pontuadas da fase 4.
Privacidade (LGPD): de pessoas, só nome e cargo já publicados pela CVM. CPF nunca é lido.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import networkx as nx

from nicho.config import ConhecimentoCfg, Universe

IGNORAR_ACIONISTAS = {"OUTROS", "ACOES TESOURARIA", "ACOES EM TESOURARIA", "TESOURARIA"}


def slug(texto: str) -> str:
    s = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", "-", s).strip("-")


def nome_limpo(texto: str) -> str:
    return " ".join(texto.split())


CODIGO_CARGO = re.compile(r"^\s*\d+\s*-\s*")


def cargo_limpo(texto: str) -> str:
    """'10 - Diretor Presidente / Superintendente' → 'Diretor Presidente / Superintendente'."""
    return CODIGO_CARGO.sub("", nome_limpo(texto))


@dataclass(frozen=True)
class Administrador:
    cnpj: str
    nome: str
    cargo: str
    orgao: str


@dataclass(frozen=True)
class Acionista:
    cnpj: str
    nome: str
    tipo_pessoa: str
    percentual: float
    controlador: bool


@dataclass(frozen=True)
class HistoriaRef:
    id: int
    titulo: str
    tickers: tuple[str, ...]
    score: float
    ultima_em: datetime


def _ultimas_versoes(linhas: list[dict[str, str]]) -> list[dict[str, str]]:
    """O FRE tem várias versões por companhia: usa só o documento mais recente de cada CNPJ."""
    ultimo: dict[str, int] = {}
    for r in linhas:
        doc = int(r.get("ID_Documento") or 0)
        ultimo[r["CNPJ_Companhia"]] = max(ultimo.get(r["CNPJ_Companhia"], 0), doc)
    return [r for r in linhas if int(r.get("ID_Documento") or 0) == ultimo[r["CNPJ_Companhia"]]]


def ler_fre(conteudo_zip: bytes, cnpjs: set[str]) -> tuple[list[Administrador], list[Acionista]]:
    def csv_de(z: zipfile.ZipFile, trecho: str) -> list[dict[str, str]]:
        nome = next(n for n in z.namelist() if trecho in n)
        texto = z.read(nome).decode("latin-1")
        return [
            r
            for r in csv.DictReader(io.StringIO(texto), delimiter=";")
            if r["CNPJ_Companhia"] in cnpjs
        ]

    with zipfile.ZipFile(io.BytesIO(conteudo_zip)) as z:
        adm = _ultimas_versoes(csv_de(z, "administrador_membro_conselho_fiscal"))
        pos = _ultimas_versoes(csv_de(z, "_posicao_acionaria_2"))

    admins = [
        Administrador(
            r["CNPJ_Companhia"],
            nome_limpo(r["Nome"]),
            cargo_limpo(r.get("Cargo_Eletivo_Ocupado") or ""),
            nome_limpo(r.get("Orgao_Administracao") or ""),
        )
        for r in adm
        # Conselho fiscal fiscaliza, não decide: fica fora do grafo de influência.
        if (r.get("Nome") or "").strip()
        and "FISCAL" not in slug(r.get("Orgao_Administracao") or "")
    ]
    acionistas = []
    for r in pos:
        if (r.get("ID_Acionista_Relacionado") or "").strip():
            continue  # só o primeiro nível da cadeia societária
        nome = nome_limpo(r.get("Acionista") or "")
        if not nome or slug(nome).replace("-", " ") in IGNORAR_ACIONISTAS:
            continue
        try:
            pct = float(r.get("Percentual_Total_Acoes_Circulacao") or 0)
        except ValueError:
            pct = 0.0
        acionistas.append(
            Acionista(
                r["CNPJ_Companhia"],
                nome,
                r.get("Tipo_Pessoa_Acionista") or "",
                pct,
                (r.get("Acionista_Controlador") or "").upper() == "S",
            )
        )
    return admins, acionistas


def cargo_destaque(cargo: str, orgao: str, destaques: Iterable[str]) -> bool:
    alvo = slug(f"{cargo} {orgao}")
    return any(slug(d) in alvo for d in destaques)


@dataclass
class GrafoConhecimento:
    g: nx.MultiGraph = field(default_factory=nx.MultiGraph)

    def no(self, id_: str, tipo: str, rotulo: str, **attrs: Any) -> str:
        if id_ not in self.g:
            self.g.add_node(id_, tipo=tipo, rotulo=rotulo, **attrs)
        return id_

    def aresta(self, a: str, b: str, relacao: str, peso: float = 1.0, **attrs: Any) -> None:
        self.g.add_edge(a, b, key=relacao, relacao=relacao, peso=peso, **attrs)


def construir(
    universe: Universe,
    cnpj_ticker: dict[str, str],
    admins: list[Administrador],
    acionistas: list[Acionista],
    historias: list[HistoriaRef],
    cfg: ConhecimentoCfg,
    agora: datetime,
) -> GrafoConhecimento:
    k = GrafoConhecimento()
    for setor, nome in universe.setores.items():
        k.no(f"setor:{setor}", "Setor", nome)
    for a in universe.ativos:
        e = k.no(f"empresa:{a.ticker}", "Empresa", a.nome, ticker=a.ticker, setor=a.setor)
        k.aresta(e, f"setor:{a.setor}", "PERTENCE_A")

    # Pessoas: cargos de destaque e quem está em mais de uma empresa do universo (interlocks).
    empresas_por_pessoa: dict[str, set[str]] = defaultdict(set)
    for p in admins:
        if p.cnpj in cnpj_ticker:
            empresas_por_pessoa[slug(p.nome)].add(cnpj_ticker[p.cnpj])
    for p in admins:
        t = cnpj_ticker.get(p.cnpj)
        if t is None:
            continue
        chave = slug(p.nome)
        if len(empresas_por_pessoa[chave]) < 2 and not cargo_destaque(
            p.cargo, p.orgao, cfg.cargos_destaque
        ):
            continue
        no = k.no(f"pessoa:{chave}", "Pessoa", p.nome.title())
        k.aresta(no, f"empresa:{t}", "ADMINISTRA", cargo=p.cargo, orgao=p.orgao)

    for s in acionistas:
        t = cnpj_ticker.get(s.cnpj)
        # Exige participação relevante mesmo de controladores: blocos familiares de controle
        # listam dezenas de pessoas com frações pequenas (ex.: WEG, 64 acionistas).
        if t is None or s.percentual < cfg.participacao_minima:
            continue
        no = k.no(f"acionista:{slug(s.nome)}", "Acionista", s.nome, tipo_pessoa=s.tipo_pessoa)
        rel = "CONTROLA" if s.controlador else "PARTICIPA"
        k.aresta(no, f"empresa:{t}", rel, percentual=round(s.percentual, 2))

    # Coocorrência em histórias, com decaimento temporal.
    pares: dict[tuple[str, str], float] = defaultdict(float)
    for h in historias:
        idade = max((agora - h.ultima_em).total_seconds() / 86400, 0.0)
        peso = 0.5 ** (idade / cfg.meia_vida_comencao_dias)
        ts = sorted(set(h.tickers))
        for i, t1 in enumerate(ts):
            for t2 in ts[i + 1 :]:
                pares[(t1, t2)] += peso
    for (t1, t2), w in pares.items():
        if f"empresa:{t1}" in k.g and f"empresa:{t2}" in k.g:
            k.aresta(f"empresa:{t1}", f"empresa:{t2}", "CO_MENCIONADA_COM", peso=round(w, 4))

    eventos = sorted(
        (h for h in historias if h.score >= cfg.score_minimo_evento and h.tickers),
        key=lambda h: -h.score,
    )[: cfg.max_eventos]
    for h in eventos:
        ev = k.no(
            f"evento:{h.id}", "Evento", h.titulo, score=h.score, ultima_em=h.ultima_em.isoformat()
        )
        for t in h.tickers:
            if f"empresa:{t}" in k.g:
                k.aresta(f"empresa:{t}", ev, "MENCIONADA_EM")
    return k


def layout(k: GrafoConhecimento, semente: int) -> dict[str, tuple[float, float]]:
    simples = nx.Graph(k.g)
    pos = nx.spring_layout(
        simples, seed=semente, k=1.5 / max(simples.number_of_nodes(), 1) ** 0.5, iterations=200
    )
    return {n: (round(float(x), 4), round(float(y), 4)) for n, (x, y) in pos.items()}


def exportar(k: GrafoConhecimento, pos: dict[str, tuple[float, float]]) -> dict[str, Any]:
    nos = []
    for n, d in sorted(k.g.nodes(data=True)):
        x, y = pos.get(n, (0.0, 0.0))
        nos.append({"id": n, "x": x, "y": y, "grau": k.g.degree(n), **d})
    arestas = []
    for a, b, d in sorted(k.g.edges(data=True), key=lambda e: (e[0], e[1], e[2]["relacao"])):
        # Direção semântica: pessoa/acionista → empresa → setor/evento.
        if a.startswith("empresa:") and d["relacao"] in ("ADMINISTRA", "CONTROLA", "PARTICIPA"):
            a, b = b, a
        if b.startswith("empresa:") and d["relacao"] in ("PERTENCE_A", "MENCIONADA_EM"):
            a, b = b, a
        arestas.append({"source": a, "target": b, **d})
    return {"nos": nos, "arestas": arestas}
