"""Documentos da CVM (Portal de Dados Abertos).

* FCA (`valor_mobiliario`): mapeia código de negociação → CNPJ da companhia.
* IPE: índice de documentos eventuais (fatos relevantes, comunicados), atualizado semanalmente.
* PDF de cada documento (link do RAD/ENET): texto extraído com PyMuPDF.

Formato verificado em 31/10/2026: CSV separado por ";" em Latin-1, dentro de ZIPs anuais.
"""

from __future__ import annotations

import csv
import hashlib
import io
import time
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from nicho.config import Universe
from nicho.http import make_client, with_retry

BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC"
SP = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class Filing:
    protocolo_entrega: str
    versao: int
    ticker: str
    cnpj: str
    categoria: str
    tipo: str | None
    especie: str | None
    assunto: str | None
    data_entrega: datetime
    data_referencia: date | None
    link_download: str


def ler_csv_zip(conteudo: bytes, nome_contem: str) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
        nome = next(n for n in z.namelist() if nome_contem in n)
        texto = z.read(nome).decode("latin-1")
    return list(csv.DictReader(io.StringIO(texto), delimiter=";"))


def mapa_cnpj(linhas_fca: Iterable[dict[str, str]], universe: Universe) -> dict[str, str]:
    """CNPJ → ticker do universo (o primeiro listado em universe.yaml, ex.: PETR4 antes de PETR3).

    Usa a versão mais recente de cada documento e ignora códigos com negociação encerrada.
    """
    por_ticker: dict[str, tuple[int, str]] = {}
    for r in linhas_fca:
        cod = (r.get("Codigo_Negociacao") or "").strip()
        if not cod or (r.get("Data_Fim_Negociacao") or "").strip():
            continue
        versao = int(r.get("Versao") or 0)
        if cod not in por_ticker or versao >= por_ticker[cod][0]:
            por_ticker[cod] = (versao, r["CNPJ_Companhia"].strip())
    out: dict[str, str] = {}
    for a in universe.ativos:
        if a.ticker in por_ticker:
            out.setdefault(por_ticker[a.ticker][1], a.ticker)
        elif a.cnpj:  # FCA com código inválido: usa o CNPJ declarado em universe.yaml
            out.setdefault(a.cnpj, a.ticker)
    return out


def _data(s: str | None) -> date | None:
    s = (s or "").strip()
    return date.fromisoformat(s) if s else None


def filtrar_ipe(
    linhas: Iterable[dict[str, str]],
    cnpj_ticker: dict[str, str],
    categorias: Sequence[str],
    desde: date,
) -> list[Filing]:
    out: list[Filing] = []
    for r in linhas:
        cnpj = (r.get("CNPJ_Companhia") or "").strip()
        if cnpj not in cnpj_ticker or r.get("Categoria") not in categorias:
            continue
        entrega = _data(r.get("Data_Entrega"))
        if entrega is None or entrega < desde:
            continue
        out.append(
            Filing(
                protocolo_entrega=r["Protocolo_Entrega"].strip(),
                versao=int(r.get("Versao") or 1),
                ticker=cnpj_ticker[cnpj],
                cnpj=cnpj,
                categoria=r["Categoria"],
                tipo=(r.get("Tipo") or None),
                especie=(r.get("Especie") or None),
                assunto=(r.get("Assunto") or "").strip() or None,
                # O IPE só tem a data; meio-dia de São Paulo evita trocar o dia ao converter fuso.
                data_entrega=datetime.combine(entrega, datetime.min.time(), SP).replace(hour=12),
                data_referencia=_data(r.get("Data_Referencia")),
                link_download=r["Link_Download"].strip(),
            )
        )
    return out


def texto_pdf(conteudo: bytes, max_chars: int) -> str:
    """Texto das primeiras páginas até `max_chars`. Erro se não for PDF."""
    if not conteudo.startswith(b"%PDF"):
        raise ValueError("o download não é um PDF")
    import pymupdf

    partes: list[str] = []
    total = 0
    with pymupdf.open(stream=conteudo, filetype="pdf") as doc:  # type: ignore[no-untyped-call]
        for page in doc:
            t = page.get_text()
            partes.append(t)
            total += len(t)
            if total >= max_chars:
                break
    texto = " ".join(" ".join(partes).split())
    return texto[:max_chars]


def hash_texto(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


class CvmClient:
    def __init__(self, client: httpx.Client | None = None, dormir: Any = time.sleep) -> None:
        self.client = client or make_client(timeout=120)
        self.dormir = dormir

    def _bytes(self, url: str) -> bytes:
        def call() -> bytes:
            r = self.client.get(url)
            r.raise_for_status()
            return r.content

        return with_retry(call, tentativas=3)

    def fca_valor_mobiliario(self, ano: int) -> list[dict[str, str]]:
        z = self._bytes(f"{BASE}/FCA/DADOS/fca_cia_aberta_{ano}.zip")
        return ler_csv_zip(z, "valor_mobiliario")

    def ipe(self, ano: int) -> list[dict[str, str]]:
        z = self._bytes(f"{BASE}/IPE/DADOS/ipe_cia_aberta_{ano}.zip")
        return ler_csv_zip(z, "ipe_cia_aberta")

    def pdf(self, url: str) -> bytes:
        return self._bytes(url)
