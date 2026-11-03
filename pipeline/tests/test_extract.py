import json
from datetime import date

import httpx
import pytest

from nicho.config import load_config
from nicho.enrich.models import Sentimento
from nicho.extract.llm import (
    Cadeia,
    Cota,
    GeminiProvider,
    GroqProvider,
    LLMIndisponivel,
    OllamaProvider,
    Resposta,
    UsoEmMemoria,
)
from nicho.extract.run import CacheMemoria, Extrator, carregar_prompt, montar_prompt
from nicho.extract.schema import Extracao

CFG = load_config()
VALIDO = {
    "tickers": ["MGLU3", "XPTO3"],
    "empresas": ["Magazine Luiza"],
    "pessoas": [],
    "setores": ["Varejo"],
    "tipo_evento": "macro",
    "valores_monetarios": [],
    "sentimento": {"label": "negativo", "score": -0.8},
    "materialidade_estimada": "alta",
    "horizonte": "curto",
    "resumo_1_linha": "Magalu cai após eleição.",
    "confianca": 0.7,
}


class Falso:
    nome, modelo = "falso", "m1"

    def __init__(self, respostas: list[str], ok: bool = True) -> None:
        self.respostas, self.ok, self.chamadas = list(respostas), ok, 0

    def disponivel(self) -> bool:
        return self.ok

    def json(self, prompt: str, temperatura: float) -> Resposta:
        self.chamadas += 1
        return Resposta(self.respostas.pop(0), self.nome, self.modelo, 10)


def _extrator(p: Falso) -> Extrator:
    n = CFG.nlp.extracao
    return Extrator(
        Cadeia([p]),
        CacheMemoria(),
        CFG.universe,
        CFG.scoring,
        n.prompt_versao,
        n.temperatura,
        n.max_caracteres_entrada,
    )


def test_prompt_tem_ancoragem_e_universo() -> None:
    modelo = carregar_prompt(CFG.nlp.extracao.prompt_versao)
    p = montar_prompt(modelo, CFG.universe, "Texto X")
    assert "Não use conhecimento externo" in p and "MGLU3: Magazine Luiza" in p
    assert p.rstrip().endswith("Texto X") and "{{" not in p


def test_extracao_ok_ancorada_e_cacheada() -> None:
    p = Falso([json.dumps(VALIDO)])
    ex = _extrator(p)
    r = ex.extrair("Magazine Luiza cai", None, ["MGLU3"], None)
    assert r.status == "ok" and r.metodo == "llm" and r.extracao is not None
    assert r.extracao.tickers == ["MGLU3"]  # XPTO3 não é do universo: descartado
    r2 = ex.extrair("Magazine Luiza cai", None, ["MGLU3"], None)
    assert r2.do_cache and p.chamadas == 1  # o mesmo texto não gasta cota de novo


def test_reparo_unico_e_falha() -> None:
    ok = _extrator(Falso(["{nao é json", "```json\n" + json.dumps(VALIDO) + "\n```"]))
    assert ok.extrair("t", None, [], None).status == "reparado"
    ruim = _extrator(Falso(['{"tickers": []}', "lixo"]))
    r = ruim.extrair("t2", None, [], None)
    assert r.status == "extraction_failed" and r.extracao is None


def test_sem_llm_cai_para_regras() -> None:
    p = Falso([], ok=False)
    ex = _extrator(p)
    r = ex.extrair(
        "Itaú anuncia aquisição de fintech", None, ["ITUB4"], Sentimento("positivo", 0.5, {})
    )
    assert r.metodo == "regras" and r.extracao is not None
    assert r.extracao.tipo_evento == "M&A" and r.extracao.materialidade_estimada == "alta"
    assert r.extracao.sentimento.label == "positivo" and r.extracao.confianca == 0.3
    assert ex.cadeia.fora == {"falso": "não configurado ou fora do ar"}


def test_schema_rejeita_campos_invalidos() -> None:
    with pytest.raises(ValueError):
        Extracao.model_validate({**VALIDO, "materialidade_estimada": "enorme"})
    with pytest.raises(ValueError):
        Extracao.model_validate({**VALIDO, "confianca": 2})


# ------------------------------------------------------------------ cota
def test_cota_diaria_e_por_minuto() -> None:
    uso = UsoEmMemoria()
    relogio = [0.0]
    dormidas: list[float] = []
    c = Cota(
        "g",
        rpm=2,
        rpd=3,
        uso=uso,
        relogio=lambda: relogio[0],
        dormir=lambda s: (dormidas.append(s), relogio.__setitem__(0, relogio[0] + s)),
        hoje=lambda: date(2026, 10, 31),
    )
    for _ in range(3):
        c.adquirir()
        c.registrar(5)
    assert len(dormidas) == 1 and dormidas[0] == pytest.approx(60.05)
    with pytest.raises(LLMIndisponivel, match="cota diária"):
        c.adquirir()


# ------------------------------------------------------------------ formato das requisições
def _cliente(
    capturadas: list[httpx.Request], resposta: dict | None, status: int = 200
) -> httpx.Client:
    def handler(req: httpx.Request) -> httpx.Response:
        capturadas.append(req)
        if req.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen2.5:7b"}]})
        return httpx.Response(status, json=resposta or {})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_gemini_formato(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "teste")
    reqs: list[httpx.Request] = []
    resp = {
        "candidates": [{"content": {"parts": [{"text": "{}"}]}}],
        "usageMetadata": {"totalTokenCount": 42},
    }
    cfg = CFG.llm.provedores["gemini"]
    p = GeminiProvider(cfg, Cota("gemini", 0, 0, UsoEmMemoria()), _cliente(reqs, resp))
    r = p.json("oi", 0.1)
    assert r.texto == "{}" and r.tokens == 42
    req = reqs[0]
    assert req.url.path.endswith(f"/models/{cfg.modelo_extracao}:generateContent")
    assert req.headers["x-goog-api-key"] == "teste"
    body = json.loads(req.content)
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_groq_formato_e_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "teste")
    reqs: list[httpx.Request] = []
    resp = {"choices": [{"message": {"content": "{}"}}], "usage": {"total_tokens": 7}}
    cfg = CFG.llm.provedores["groq"]
    p = GroqProvider(cfg, Cota("groq", 0, 0, UsoEmMemoria()), _cliente(reqs, resp))
    assert p.json("oi", 0.1).tokens == 7
    body = json.loads(reqs[0].content)
    assert reqs[0].headers["authorization"] == "Bearer teste"
    assert body["response_format"] == {"type": "json_object"}
    lim = GroqProvider(cfg, Cota("groq", 0, 0, UsoEmMemoria()), _cliente([], {}, 429))
    with pytest.raises(LLMIndisponivel, match="429"):
        lim.json("oi", 0.1)


def test_ollama_disponibilidade_e_formato() -> None:
    reqs: list[httpx.Request] = []
    resp = {"message": {"content": "{}"}, "prompt_eval_count": 3, "eval_count": 4}
    cfg = CFG.llm.provedores["ollama"]
    p = OllamaProvider(cfg, Cota("ollama", 0, 0, UsoEmMemoria()), _cliente(reqs, resp))
    assert p.disponivel()
    assert p.json("oi", 0.1).tokens == 7
    body = json.loads(reqs[-1].content)
    assert body["format"] == "json" and body["stream"] is False


def test_sem_chave_provedor_fica_indisponivel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    p = GeminiProvider(CFG.llm.provedores["gemini"], Cota("gemini", 0, 0, UsoEmMemoria()))
    assert not p.disponivel()


def test_limite_de_cota_vale_so_para_chamadas_ao_llm() -> None:
    p = Falso([json.dumps(VALIDO), json.dumps({**VALIDO, "resumo_1_linha": "outro"})])
    n = CFG.nlp.extracao
    ex = Extrator(
        Cadeia([p]),
        CacheMemoria(),
        CFG.universe,
        CFG.scoring,
        n.prompt_versao,
        n.temperatura,
        n.max_caracteres_entrada,
        max_llm=1,
    )
    assert ex.extrair("Magazine Luiza cai", None, ["MGLU3"], None).metodo == "llm"
    assert ex.extrair("Magazine Luiza cai", None, ["MGLU3"], None).do_cache  # cache não conta
    segundo = ex.extrair("Vale sobe", None, ["VALE3"], None)
    assert segundo.metodo == "regras" and p.chamadas == 1
