from datetime import UTC, datetime

import httpx

from nicho.config import load_config
from nicho.ingest.news import (
    Coletor,
    MatcherTickers,
    NewsItem,
    filtrar_e_marcar,
    limpar_html,
    parse_feed,
    parse_gdelt,
)

CFG = load_config()

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Portal</title>
<item><title>Petrobras anuncia novo plano &amp; investimentos</title>
<link>https://exemplo.com/a</link><pubDate>Fri, 30 Oct 2026 14:05:00 -0300</pubDate>
<description>&lt;p&gt;A <b>Petrobras</b> divulgou   hoje o plano.&lt;/p&gt;</description></item>
<item><title>Sem data</title><link>https://exemplo.com/b</link></item>
</channel></rss>"""

GOOGLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item><title>Magazine Luiza cai quase 60% ap\xc3\xb3s elei\xc3\xa7\xc3\xa3o - Estad\xc3\xa3o</title>
<link>https://news.google.com/rss/articles/x</link>
<pubDate>Mon, 26 Oct 2026 18:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;Magazine Luiza cai&lt;/a&gt;</description>
<source url="https://www.estadao.com.br">Estad\xc3\xa3o</source></item>
</channel></rss>"""


def test_parse_rss_limpa_html_e_converte_fuso() -> None:
    itens = parse_feed(RSS, "portal", "Portal", "rss", 600)
    assert len(itens) == 1  # o item sem data é descartado
    it = itens[0]
    assert it.titulo == "Petrobras anuncia novo plano & investimentos"
    assert it.resumo == "A Petrobras divulgou hoje o plano."
    assert it.publicado_em == datetime(2026, 10, 30, 17, 5, tzinfo=UTC)


def test_google_news_separa_veiculo_do_titulo() -> None:
    (it,) = parse_feed(GOOGLE, "google_news", "Google News", "google_news", 600)
    assert it.titulo == "Magazine Luiza cai quase 60% após eleição"
    assert it.fonte_nome == "Estadão"
    assert it.fonte_id == "gn:estadao"
    assert it.resumo is None


def test_parse_gdelt() -> None:
    payload = {
        "articles": [
            {
                "title": "Embraer entrega jatos",
                "url": "https://x/1",
                "seendate": "20261030T120000Z",
                "domain": "x.com.br",
            },
            {"title": "sem url", "seendate": "20261030T120000Z"},
        ]
    }
    (it,) = parse_gdelt(payload)
    assert it.fonte_id == "gdelt:x.com.br" and it.publicado_em.hour == 12


def test_limpar_html_trunca_em_palavra() -> None:
    assert limpar_html("<p>um dois três quatro</p>", 12) == "um dois…"
    assert limpar_html("   ", 50) is None


def test_matcher_diferencia_maiusculas_e_ignora_acentos() -> None:
    m = MatcherTickers(CFG.universe.ativos)
    assert m.tickers("Localiza amplia frota") == ("RENT3",)
    assert m.tickers("Polícia localiza suspeito") == ()
    assert m.tickers("Ações da Vivo sobem") == ("VIVT3",)
    assert m.tickers("o mercado está vivo") == ()
    assert set(m.tickers("Itau Unibanco e PETR4 em alta")) == {"ITUB4", "PETR4"}
    assert m.tickers("Europa avança") == ()


def test_filtrar_remove_antigos_e_duplicados() -> None:
    m = MatcherTickers(CFG.universe.ativos)
    novo = NewsItem("p", "P", "Vale sobe", "l", None, datetime(2026, 10, 30, tzinfo=UTC), "rss")
    dup = NewsItem("p", "P", "VALE  sobe", "l2", None, datetime(2026, 10, 29, tzinfo=UTC), "rss")
    velho = NewsItem("p", "P", "Outra", "l3", None, datetime(2026, 1, 1, tzinfo=UTC), "rss")
    out = filtrar_e_marcar([novo, dup, velho], m, datetime(2026, 10, 1, tzinfo=UTC))
    assert [i.link for i in out] == ["l"]  # título igual após normalizar = mesmo item
    assert out[0].tickers == ("VALE3",)


def test_mesmo_titulo_em_fontes_diferentes_sao_itens_diferentes() -> None:
    a = NewsItem("a", "A", "Vale sobe", "l", None, datetime(2026, 10, 30, tzinfo=UTC), "rss")
    b = NewsItem("b", "B", "Vale sobe", "l", None, datetime(2026, 10, 30, tzinfo=UTC), "rss")
    assert a.content_hash != b.content_hash


def test_coletor_trata_limite_do_gdelt_e_falha_de_feed() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if "gdeltproject" in req.url.host:
            return httpx.Response(
                200,
                text="Please limit requests to one every 5 seconds",
                headers={"content-type": "text/plain"},
            )
        if "news.google" in req.url.host:
            return httpx.Response(200, content=GOOGLE)
        return httpx.Response(503)

    dormidas: list[float] = []
    col = Coletor(
        CFG.sources, httpx.Client(transport=httpx.MockTransport(handler)), dormidas.append
    )
    ativos = CFG.universe.ativos[:3]
    g = col.gdelt(ativos, por_consulta=2, dias=7)
    assert g.itens == [] and len(g.falhas) == 2 and "limit" in g.falhas[0]
    assert dormidas == [CFG.sources.gdelt.min_intervalo_segundos] * 2
    gn = col.google_news(ativos)
    assert len(gn.itens) == 3 and gn.falhas == []
    rss = col.rss(600)
    assert rss.itens == [] and len(rss.falhas) == len(CFG.sources.rss)
