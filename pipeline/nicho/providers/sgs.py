"""Cliente da API SGS do Banco Central.

Verificado em 31/10/2026: séries diárias exigem `dataInicial` e aceitam janela máxima de 10 anos
por consulta. O cliente divide o período em janelas menores para qualquer intervalo pedido.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from nicho.http import make_client, with_retry

BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados"
JANELA_MAX_DIAS = 3650  # < 10 anos, com folga para anos bissextos


@dataclass(frozen=True)
class Observacao:
    dia: date
    valor: float


def janelas(inicio: date, fim: date, max_dias: int = JANELA_MAX_DIAS) -> list[tuple[date, date]]:
    """Divide [inicio, fim] em janelas contíguas de no máximo `max_dias` dias, sem sobreposição."""
    if fim < inicio:
        return []
    out: list[tuple[date, date]] = []
    a = inicio
    while a <= fim:
        b = min(a + timedelta(days=max_dias - 1), fim)
        out.append((a, b))
        a = b + timedelta(days=1)
    return out


def parse(payload: list[dict[str, Any]], ate: date | None = None) -> list[Observacao]:
    """Converte a resposta do SGS e descarta datas futuras (a meta da Selic vem adiantada)."""
    out: list[Observacao] = []
    for item in payload:
        dia = datetime.strptime(item["data"], "%d/%m/%Y").date()
        if ate is not None and dia > ate:
            continue
        valor = item.get("valor")
        if valor in (None, ""):
            continue
        out.append(Observacao(dia, float(valor)))
    return out


class SgsClient:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or make_client()

    def serie(self, codigo: int, inicio: date, fim: date) -> list[Observacao]:
        vistos: dict[date, Observacao] = {}
        for a, b in janelas(inicio, fim):

            def call(a: date = a, b: date = b) -> list[dict[str, Any]]:
                r = self.client.get(
                    BASE.format(codigo=codigo),
                    params={
                        "formato": "json",
                        "dataInicial": a.strftime("%d/%m/%Y"),
                        "dataFinal": b.strftime("%d/%m/%Y"),
                    },
                )
                if r.status_code == 404:
                    return []  # janela sem observações
                r.raise_for_status()
                data: list[dict[str, Any]] = r.json()
                return data

            for obs in parse(with_retry(call), ate=fim):
                vistos[obs.dia] = obs
        return sorted(vistos.values(), key=lambda o: o.dia)
