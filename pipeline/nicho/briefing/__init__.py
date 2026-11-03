"""Briefing diário: o que um assessor precisa saber antes das 10h.

Gerado só com dados do banco, sem LLM: cada item de texto carrega as referências [n] das fontes
que o sustentam (cotação, SGS, notícia, documento da CVM ou cálculo do próprio Nicho Capital). É
versionado: cada execução no mesmo dia grava uma nova versão na tabela `briefings`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import psycopg

SGS_LINK = "https://www3.bcb.gov.br/sgspub/"
N_MOVERS = 3
N_HISTORIAS = 6
PREGOES_ANOMALIAS = 3
SEVERIDADES = ("alta", "media")


@dataclass
class Fontes:
    """Numera as fontes por link, na ordem de primeira citação."""

    itens: list[dict[str, Any]] = field(default_factory=list)

    def ref(self, titulo: str, link: str, origem: str, data: str) -> int:
        for f in self.itens:
            if f["link"] == link:
                return int(f["n"])
        n = len(self.itens) + 1
        self.itens.append({"n": n, "titulo": titulo, "link": link, "origem": origem, "data": data})
        return n


def _pct(x: float) -> str:
    s = f"{abs(x) * 100:.2f}".replace(".", ",")
    return f"{'+' if x >= 0 else '−'}{s}%"


def _num(x: float, casas: int = 2) -> str:
    s = f"{abs(x):,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"−{s}" if x < 0 else s


def _data_br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def build_briefing(
    dia: date,
    retornos: dict[str, float],
    ativos: dict[str, dict[str, Any]],
    indice: str,
    anomalias: list[dict[str, Any]],
    historias: list[dict[str, Any]],
    documentos: list[dict[str, Any]],
    macro: dict[str, Any],
    gerado_em: datetime,
) -> dict[str, Any]:
    """Monta o briefing a partir de dados já consultados (função pura, testável)."""
    fontes = Fontes()
    secoes: list[dict[str, Any]] = []

    def cot(t: str) -> int:
        return fontes.ref(
            f"Cotações diárias de {t}",
            f"/ativo/{t}",
            "Nicho Capital (Yahoo Finance)",
            dia.isoformat(),
        )

    def sgs() -> int:
        return fontes.ref(
            "Sistema Gerenciador de Séries Temporais",
            SGS_LINK,
            "Banco Central do Brasil",
            dia.isoformat(),
        )

    # 1. Mercado
    itens: list[dict[str, Any]] = []
    if indice in retornos:
        itens.append(
            {
                "texto": f"Ibovespa {_pct(retornos[indice])} no pregão de {_data_br(dia)}.",
                "refs": [cot(indice)],
            }
        )
    acoes = sorted(
        ((t, r) for t, r in retornos.items() if t != indice and t in ativos),
        key=lambda x: x[1],
    )
    if acoes:
        altas = [x for x in reversed(acoes[-N_MOVERS:]) if x[1] > 0]
        baixas = [x for x in acoes[:N_MOVERS] if x[1] < 0]
        if altas:
            itens.append(
                {
                    "texto": "Maiores altas: "
                    + "; ".join(f"{t} {_pct(r)}" for t, r in altas)
                    + ".",
                    "refs": [cot(t) for t, _ in altas],
                }
            )
        if baixas:
            itens.append(
                {
                    "texto": "Maiores baixas: "
                    + "; ".join(f"{t} {_pct(r)}" for t, r in baixas)
                    + ".",
                    "refs": [cot(t) for t, _ in baixas],
                }
            )
        sobe = sum(1 for _, r in acoes if r > 0)
        itens.append(
            {
                "texto": f"Amplitude: {sobe} de {len(acoes)} ações do universo subiram.",
                "refs": [
                    fontes.ref(
                        "Mapa setorial do universo",
                        "/",
                        "Nicho Capital (Yahoo Finance)",
                        dia.isoformat(),
                    )
                ],
            }
        )
    secoes.append({"id": "mercado", "titulo": "Mercado", "itens": itens})

    # 2. Macro
    itens = []
    if macro.get("selic") is not None:
        itens.append({"texto": f"Selic meta em {_num(macro['selic'])}% ao ano.", "refs": [sgs()]})
    if macro.get("ipca") is not None:
        mes = macro["ipca_mes"]
        itens.append(
            {
                "texto": f"IPCA de {mes:%m/%Y}: {_num(macro['ipca'])}% no mês"
                + (
                    f", {_num(macro['ipca_12m'])}% em 12 meses."
                    if macro.get("ipca_12m") is not None
                    else "."
                ),
                "refs": [sgs()],
            }
        )
    if macro.get("ptax") is not None:
        var = f" ({_pct(macro['ptax_var'])} no dia)" if macro.get("ptax_var") is not None else ""
        itens.append(
            {
                "texto": f"Dólar PTAX (venda) a R$ {_num(macro['ptax'], 4)}{var}.",
                "refs": [sgs()],
            }
        )
    secoes.append({"id": "macro", "titulo": "Juros, inflação e câmbio", "itens": itens})

    # 3. Notícias mais relevantes
    itens = []
    for h in historias[:N_HISTORIAS]:
        refs = [fontes.ref(i["titulo"], i["link"], i["origem"], i["data"]) for i in h["itens"][:2]]
        tick = f" ({', '.join(h['tickers'][:3])})" if h["tickers"] else ""
        itens.append({"texto": f"{h['titulo']}{tick} — score {round(h['score'])}.", "refs": refs})
    secoes.append({"id": "noticias", "titulo": "Notícias mais relevantes", "itens": itens})

    # 4. Documentos da CVM
    itens = []
    for d in documentos:
        refs = [fontes.ref(d["titulo"], d["link"], "CVM", d["data"])]
        itens.append({"texto": f"{d['ticker']}: {d['titulo']}.", "refs": refs})
    secoes.append({"id": "cvm", "titulo": "Fatos relevantes e comunicados (CVM)", "itens": itens})

    # 5. Anomalias estatísticas
    itens = []
    for a in anomalias:
        ref = fontes.ref(
            f"Anomalias de {a['ticker']}",
            f"/ativo/{a['ticker']}",
            "Nicho Capital (cálculo)",
            dia.isoformat(),
        )
        itens.append(
            {
                "texto": f"{a['ticker']}: {a['descricao']} (severidade {a['severidade']}).",
                "refs": [ref],
            }
        )
    secoes.append({"id": "anomalias", "titulo": "Anomalias estatísticas", "itens": itens})

    for s in secoes:
        if not s["itens"]:
            s["itens"] = [{"texto": "Não encontrei dados para esta seção.", "refs": []}]
    return {
        "dia": dia.isoformat(),
        "gerado_em": gerado_em.isoformat(),
        "metodo": "regras",
        "secoes": secoes,
        "fontes": fontes.itens,
        "aviso": "Ferramenta educacional. Não constitui recomendação de investimento. "
        "Dados públicos com atraso.",
    }


DESCRICAO_METODO = {
    "robust_z_retorno": "retorno atípico",
    "robust_z_volume": "volume atípico",
    "change_point": "mudança de regime",
}


def query_briefing_inputs(conn: psycopg.Connection, indice: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select max(dia) from prices_daily where ticker = %s", (indice,))
        dia: date | None = cur.fetchone()[0]  # type: ignore[index]
        if dia is None:
            raise RuntimeError("sem preços do índice: rode `nicho ingest precos` antes")
        cur.execute(
            """
            select ticker, dia, coalesce(adj_close, close) from prices_daily
            where dia in (select distinct dia from prices_daily where ticker = %s and dia <= %s
                          order by dia desc limit 2)
            order by ticker, dia
            """,
            (indice, dia),
        )
        por: dict[str, list[float]] = {}
        for t, _, px in cur.fetchall():
            por.setdefault(t, []).append(float(px))
        retornos = {t: v[1] / v[0] - 1 for t, v in por.items() if len(v) == 2 and v[0]}
        cur.execute("select ticker, nome, setor from assets where not is_index")
        ativos = {t: {"nome": n, "setor": s} for t, n, s in cur.fetchall()}
        cur.execute(
            """
            select ticker, dia, metodo, valor, severidade from anomalies
            where dia in (select distinct dia from prices_daily where ticker = %s and dia <= %s
                          order by dia desc limit %s)
              and severidade = any(%s)
            order by (severidade = 'alta') desc, dia desc, abs(valor) desc limit 8
            """,
            (indice, dia, PREGOES_ANOMALIAS, list(SEVERIDADES)),
        )
        anomalias = [
            {
                "ticker": t,
                "severidade": sev,
                "descricao": f"{DESCRICAO_METODO.get(m, m)} em {_data_br(d)}"
                + (f" (z = {_num(float(v))})" if m.startswith("robust_z") else ""),
            }
            for t, d, m, v, sev in cur.fetchall()
        ]
        cur.execute(
            """
            select s.id, s.titulo, s.tickers, r.score from stories s
            join relevance_scores r on r.story_id = s.id
            where s.ultima_em >= %s::date - 1
            order by r.score desc limit %s
            """,
            (dia, N_HISTORIAS),
        )
        historias = [
            {"id": i, "titulo": tit, "tickers": list(tk or []), "score": float(sc), "itens": []}
            for i, tit, tk, sc in cur.fetchall()
        ]
        if historias:
            cur.execute(
                """
                select si.story_id, n.titulo, n.link, n.fonte_nome, n.publicado_em
                from story_items si join news_items n on n.id = si.news_item_id
                where si.story_id = any(%s) order by n.publicado_em
                """,
                ([h["id"] for h in historias],),
            )
            por_id = {h["id"]: h for h in historias}
            for sid, tit, link, origem, pub in cur.fetchall():
                por_id[sid]["itens"].append(
                    {"titulo": tit, "link": link, "origem": origem, "data": pub.isoformat()}
                )
        cur.execute(
            """
            select ticker, categoria || coalesce(': ' || assunto, ''), link_download, data_entrega
            from filings
            where ticker is not null and data_entrega >= %s::date - 7
              and categoria in ('Fato Relevante', 'Comunicado ao Mercado')
            order by (categoria = 'Fato Relevante') desc, data_entrega desc limit 8
            """,
            (dia,),
        )
        documentos = [
            {"ticker": t, "titulo": tit, "link": link, "data": de.isoformat()}
            for t, tit, link, de in cur.fetchall()
        ]
        macro = _query_macro(cur)
    return {
        "dia": dia,
        "retornos": retornos,
        "ativos": ativos,
        "anomalias": anomalias,
        "historias": historias,
        "documentos": documentos,
        "macro": macro,
    }


def _query_macro(cur: psycopg.Cursor) -> dict[str, Any]:
    def serie(slug: str, n: int) -> list[tuple[date, float]]:
        cur.execute(
            "select o.dia, o.valor from macro_observations o join macro_series s "
            "on s.codigo_sgs = o.codigo_sgs where s.slug = %s order by o.dia desc limit %s",
            (slug, n),
        )
        return [(d, float(v)) for d, v in cur.fetchall()]

    out: dict[str, Any] = {}
    if selic := serie("selic_meta", 1):
        out["selic"] = selic[0][1]
    if ipca := serie("ipca_mensal", 12):
        out["ipca"], out["ipca_mes"] = ipca[0][1], ipca[0][0]
        if len(ipca) == 12:
            acc = 1.0
            for _, v in ipca:
                acc *= 1 + v / 100
            out["ipca_12m"] = (acc - 1) * 100
    if ptax := serie("ptax_venda", 2):
        out["ptax"] = ptax[0][1]
        if len(ptax) == 2:
            out["ptax_var"] = ptax[0][1] / ptax[1][1] - 1
    return out


def salvar_briefing(conn: psycopg.Connection, conteudo: dict[str, Any]) -> int:
    """Grava uma nova versão do briefing do dia. Devolve o número da versão."""
    with conn.cursor() as cur:
        cur.execute(
            "select coalesce(max(versao), 0) + 1 from briefings where dia = %s", (conteudo["dia"],)
        )
        versao = int(cur.fetchone()[0])  # type: ignore[index]
        conteudo["versao"] = versao
        cur.execute(
            "insert into briefings (dia, versao, conteudo, provedor, modelo) "
            "values (%s, %s, %s, null, null)",
            (conteudo["dia"], versao, json.dumps(conteudo, ensure_ascii=False)),
        )
    conn.commit()
    return versao


def query_briefings_export(conn: psycopg.Connection, limite: int = 10) -> dict[str, Any]:
    """briefing.json: a última versão de cada um dos últimos dias."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select distinct on (dia) conteudo from briefings
            order by dia desc, versao desc limit %s
            """,
            (limite,),
        )
        return {"briefings": [r[0] for r in cur.fetchall()]}
