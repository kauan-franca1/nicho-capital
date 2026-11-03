import itertools
import json
from datetime import date
from pathlib import Path

import httpx

from nicho.providers.sgs import SgsClient, janelas, parse

FIXTURES = Path(__file__).parent / "fixtures"


def test_janelas_respeitam_limite_e_nao_se_sobrepoem() -> None:
    js = janelas(date(2010, 1, 1), date(2026, 10, 31))
    assert js[0][0] == date(2010, 1, 1) and js[-1][1] == date(2026, 10, 31)
    for (a, b), (c, _) in itertools.pairwise(js):
        assert (b - a).days < 3650
        assert (c - b).days == 1


def test_janela_unica_quando_curta() -> None:
    assert janelas(date(2026, 1, 1), date(2026, 1, 31)) == [(date(2026, 1, 1), date(2026, 1, 31))]
    assert janelas(date(2026, 2, 1), date(2026, 1, 1)) == []


def test_parse_resposta_real_ptax() -> None:
    payload = json.loads((FIXTURES / "sgs_1_semana.json").read_text(encoding="utf-8"))
    obs = parse(payload)
    assert obs[0].dia == date(2026, 10, 27)
    assert obs[-1].valor == 5.4212


def test_parse_descarta_datas_futuras_e_vazias() -> None:
    payload = [
        {"data": "30/10/2026", "valor": "13.75"},
        {"data": "31/10/2026", "valor": ""},
        {"data": "03/11/2026", "valor": "13.75"},
    ]
    assert [o.dia for o in parse(payload, ate=date(2026, 10, 31))] == [date(2026, 10, 30)]


def test_cliente_divide_janelas_e_trata_404_como_vazio() -> None:
    pedidos: list[dict[str, str]] = []
    ptax = (FIXTURES / "sgs_1_semana.json").read_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        pedidos.append(dict(request.url.params))
        if request.url.params["dataFinal"].endswith("2026"):
            return httpx.Response(200, content=ptax)
        return httpx.Response(404, json={"erro": {"statusCode": 404}})

    client = SgsClient(httpx.Client(transport=httpx.MockTransport(handler)))
    obs = client.serie(1, date(2010, 1, 1), date(2026, 10, 31))
    assert len(pedidos) == 2
    assert all(p["formato"] == "json" for p in pedidos)
    assert len(obs) == 4
