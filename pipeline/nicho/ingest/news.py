"""Coleta de notícias: RSS de portais, Google News RSS por empresa e GDELT DOC 2.0.

Regras (prompt §5.1 e §10): só título, link, fonte, data e o resumo que a fonte fornece.
Nada de texto integral nem scraping. User-Agent identificado e intervalos mínimos entre chamadas.
"""

from __future__ import annotations

import calendar
import hashlib
import html
import re
import time
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote_plus

import httpx

from nicho.config import Ativo, Sources
from nicho.http import make_client, with_retry
from nicho.log import get_logger

log = get_logger(__name__)
TAG_RE = re.compile(r"<[^>]+>")
ESPACOS_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class NewsItem:
    fonte_id: str
    fonte_nome: str
    titulo: str
    link: str
    resumo: str | None
    publicado_em: datetime  # com fuso (UTC)
    coletado_via: str  # rss | google_news | gdelt
    tickers: tuple[str, ...] = field(default=())

    @property
    def content_hash(self) -> str:
        """Identidade do item: título normalizado + fonte.

        O mesmo texto em outro portal é outro item
        (e conta como fonte independente na história)."""
        base = f"{self.fonte_id}|{normalizar(self.titulo)}"
        return hashlib.sha256(base.encode("utf-8")).hexdigest()


def sem_acentos(texto: str) -> str:
    sem = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return ESPACOS_RE.sub(" ", sem).strip()


def normalizar(texto: str) -> str:
    return sem_acentos(texto).lower()


def limpar_html(texto: str | None, limite: int) -> str | None:
    if not texto:
        return None
    # Desescapa antes de tirar as tags: alguns feeds mandam o HTML escapado (&lt;p&gt;).
    t = ESPACOS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", html.unescape(texto)))).strip()
    if not t:
        return None
    return t if len(t) <= limite else t[: limite - 1].rsplit(" ", 1)[0] + "…"


# ------------------------------------------------------------------ menções do universo
class MatcherTickers:
    """Encontra empresas do universo no texto pelos apelidos de config/universe.yaml.

    Ignora acentos mas diferencia maiúsculas: vários apelidos são palavras comuns em minúsculas
    ("Localiza" e "localiza", "Vivo" e "vivo"), e nomes de empresa vêm capitalizados nas manchetes.
    """

    def __init__(self, ativos: Sequence[Ativo]) -> None:
        self.padroes: list[tuple[str, re.Pattern[str]]] = []
        for a in ativos:
            termos = {a.ticker, *a.apelidos}
            alternativas = "|".join(
                re.escape(sem_acentos(t)) for t in sorted(termos, key=len, reverse=True)
            )
            self.padroes.append((a.ticker, re.compile(rf"(?<![\w]){alternativas}(?![\w])")))

    def tickers(self, *textos: str | None) -> tuple[str, ...]:
        alvo = sem_acentos(" ".join(t for t in textos if t))
        return tuple(t for t, p in self.padroes if p.search(alvo))


# ------------------------------------------------------------------ parsing
def _data(entry: Any) -> datetime | None:
    for chave in ("published_parsed", "updated_parsed"):
        st = entry.get(chave)
        if st:
            return datetime.fromtimestamp(calendar.timegm(st), UTC)
    return None


def parse_feed(
    conteudo: bytes,
    fonte_id: str,
    fonte_nome: str,
    via: str,
    resumo_max: int,
) -> list[NewsItem]:
    import feedparser

    feed = feedparser.parse(conteudo)
    out: list[NewsItem] = []
    for e in feed.entries:
        titulo = (e.get("title") or "").strip()
        link = e.get("link")
        quando = _data(e)
        if not titulo or not link or quando is None:
            continue
        nome = fonte_nome
        fid = fonte_id
        if via == "google_news":
            # Título vem como "Manchete - Veículo"; o veículo também vem em <source>.
            src = e.get("source") or {}
            veiculo = (src.get("title") if isinstance(src, dict) else None) or ""
            if veiculo and titulo.endswith(f" - {veiculo}"):
                titulo = titulo[: -len(veiculo) - 3].strip()
            if veiculo:
                nome = veiculo
                fid = "gn:" + normalizar(veiculo).replace(" ", "-")
        resumo = limpar_html(e.get("summary"), resumo_max)
        if via == "google_news":
            resumo = None  # o "resumo" do Google News é só o título com link: não agrega
        out.append(NewsItem(fid, nome, titulo, link, resumo, quando, via))
    return out


def parse_gdelt(payload: dict[str, Any]) -> list[NewsItem]:
    out: list[NewsItem] = []
    for a in payload.get("articles") or []:
        titulo, link, seen = a.get("title"), a.get("url"), a.get("seendate")
        if not titulo or not link or not seen:
            continue
        quando = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        dominio = a.get("domain") or "gdelt"
        out.append(
            NewsItem(f"gdelt:{dominio}", dominio, titulo.strip(), link, None, quando, "gdelt")
        )
    return out


# ------------------------------------------------------------------ coleta
@dataclass
class ColetaResultado:
    itens: list[NewsItem] = field(default_factory=list)
    falhas: list[str] = field(default_factory=list)


class Coletor:
    def __init__(
        self,
        sources: Sources,
        client: httpx.Client | None = None,
        dormir: Any = time.sleep,
    ) -> None:
        self.sources = sources
        self.client = client or make_client(timeout=30)
        self.dormir = dormir

    def _get(self, url: str, **params: Any) -> httpx.Response:
        def call() -> httpx.Response:
            r = self.client.get(url, params=params or None)
            r.raise_for_status()
            return r

        return with_retry(call, tentativas=3)

    def rss(self, resumo_max: int) -> ColetaResultado:
        res = ColetaResultado()
        for f in self.sources.rss:
            try:
                r = self._get(str(f.url))
                res.itens += parse_feed(r.content, f.id, f.nome, "rss", resumo_max)
            except Exception as exc:
                res.falhas.append(f"rss {f.id}: {exc!r}")
        return res

    def google_news(self, ativos: Iterable[Ativo]) -> ColetaResultado:
        res = ColetaResultado()
        cfg = self.sources.google_news
        for a in ativos:
            consulta = f'"{a.nome}" OR {a.ticker}'
            url = cfg.url_template.replace("{query}", quote_plus(consulta))
            try:
                r = self._get(url)
                res.itens += parse_feed(r.content, "google_news", "Google News", "google_news", 0)
            except Exception as exc:
                res.falhas.append(f"google_news {a.ticker}: {exc!r}")
            self.dormir(cfg.min_intervalo_segundos)
        return res

    def gdelt(self, ativos: Sequence[Ativo], por_consulta: int, dias: int) -> ColetaResultado:
        res = ColetaResultado()
        cfg = self.sources.gdelt
        for i in range(0, len(ativos), por_consulta):
            grupo = ativos[i : i + por_consulta]
            nomes = " OR ".join(f'"{a.nome}"' if " " in a.nome else a.nome for a in grupo)
            query = f"({nomes}) {cfg.query_sufixo}".strip()
            try:
                r = self._get(
                    str(cfg.url),
                    query=query,
                    mode=cfg.mode,
                    format=cfg.format,
                    maxrecords=cfg.maxrecords,
                    timespan=f"{min(dias, 90)}d",
                )
                if not r.headers.get("content-type", "").startswith("application/json"):
                    # A API responde texto puro quando limita a taxa.
                    res.falhas.append(f"gdelt: {r.text[:80]!r}")
                else:
                    res.itens += parse_gdelt(r.json())
            except Exception as exc:
                res.falhas.append(f"gdelt grupo {i // por_consulta}: {exc!r}")
            self.dormir(cfg.min_intervalo_segundos)
        return res


def filtrar_e_marcar(
    itens: Iterable[NewsItem], matcher: MatcherTickers, desde: datetime
) -> list[NewsItem]:
    """Descarta itens antigos e duplicados exatos; marca os tickers mencionados."""
    vistos: set[str] = set()
    out: list[NewsItem] = []
    for it in sorted(itens, key=lambda x: x.publicado_em, reverse=True):
        if it.publicado_em < desde or it.content_hash in vistos:
            continue
        vistos.add(it.content_hash)
        out.append(
            NewsItem(
                it.fonte_id,
                it.fonte_nome,
                it.titulo,
                it.link,
                it.resumo,
                it.publicado_em,
                it.coletado_via,
                matcher.tickers(it.titulo, it.resumo),
            )
        )
    return out


def desde_dias(dias: int, agora: datetime | None = None) -> datetime:
    return (agora or datetime.now(UTC)) - timedelta(days=dias)
