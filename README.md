# Nicho Capital

**Um analista de mercado com IA para quem atende clientes.** Antes da primeira ligação do dia, um banker ou assessor precisa saber o que mexeu na bolsa, o que é notícia de verdade e quem mais é afetado. O Nicho Capital lê a B3, filtra notícias e fatos relevantes da CVM, conecta empresas em grafos e explica os movimentos em linguagem natural, sempre citando as fontes. Custa R$ 0 para operar e funciona offline em modo demo.

**Demo ao vivo:** https://nicho-capital.vercel.app (modo demo: snapshot de 30/10/2026, analista por regras)

> Projeto pessoal de portfólio, sem vínculo com nenhuma instituição financeira.
> Ferramenta educacional. Não constitui recomendação de investimento. Dados públicos com atraso.

## Status

| Fase | Entrega | Situação |
|---|---|---|
| 1. Fundação | Repositório, config, schema, CI, design tokens, layout base | ✅ concluída |
| 2. Dados de mercado | Cotações, macro, home e página de ativo | ✅ concluída |
| 3. Estatística | Anomalias, GARCH, event study | ✅ concluída |
| 4. Notícias e CVM | Dedupe, extração com LLM, sentimento, score | ✅ concluída |
| 5. Grafos | MST, grafo de conhecimento, choque | ✅ concluída |
| 6. Agente | /analista: tool-calling com fallback Gemini → Groq → Ollama → regras | ✅ concluída |
| 7. Briefing e automação | Cron (GitHub Actions), briefing diário versionado, /status | ✅ concluída |
| 8. Polimento | /metodologia (KaTeX), make demo, roteiro, Lighthouse, deploy do demo na Vercel | 🟡 falta perf. mobile ≥ 90 |

Plano completo: [`docs/plano-de-implementacao.md`](docs/plano-de-implementacao.md). Roteiro de apresentação em 5 minutos: [`docs/roteiro-demo.md`](docs/roteiro-demo.md).

## O que tem

| Página | Para quê |
|---|---|
| `/` Mercado | Ibovespa, maiores altas e baixas, heatmap setorial, Selic, IPCA e dólar |
| `/ativo/[ticker]` | Candles, anomalias (z-score robusto, change points), GARCH(1,1), event studies com CAR e IC, notícias e documentos no gráfico, vizinhos no grafo |
| `/noticias` | Notícias deduplicadas em histórias, score de relevância decomposto, sentimento FinBERT-PT-BR |
| `/grafos` | Rede de correlação (Mantegna, MST, Louvain) com slider temporal, grafo de conhecimento (FRE/CVM) e propagação de choque |
| `/analista` | Agente com ferramentas: passos visíveis, fontes citadas, sem recomendação; Gemini → Groq → Ollama → regras |
| `/briefing` | O que saber antes das 10h, com citação em cada item; versionado e imprimível |
| `/status` | Execuções do pipeline e cotas gratuitas |
| `/metodologia` | Fórmulas (KaTeX), parâmetros e limitações: renderiza os `docs/metodologia-*.md` |

## Arquitetura

```mermaid
flowchart TB
  subgraph GA[GitHub Actions — cron]
    P[pipeline/ Python 3.12]
  end
  P -->|upsert idempotente| DB[(Supabase Postgres + pgvector)]
  P -->|export semanal| SNAP[demo/ snapshot JSON]
  DB --> WEB[web/ Next.js na Vercel]
  SNAP -->|DEMO_MODE=true| WEB
  WEB --> AG[/api/agent/]
  AG --> L1[Gemini] -.fallback.-> L2[Groq] -.fallback.-> L3[Ollama local]
```

- **Pipeline (Python)** e **produto (TypeScript)** só conversam pelo banco, com schema versionado em [`db/migrations/`](db/migrations).
- **Configuração central** em [`config/`](config): universo de ativos, fontes de notícias, pesos do score e provedores de LLM.
- **Decisões** em [`docs/ADRs/`](docs/ADRs) e [`docs/decisoes-de-design.md`](docs/decisoes-de-design.md).

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org) 20.9+, [uv](https://docs.astral.sh/uv/) (instala o Python sozinho) e, opcionalmente, Docker e [Ollama](https://ollama.com).

```bash
make setup     # ou: powershell -File scripts/nicho.ps1 setup
make dev       # http://localhost:3000 — lê o snapshot versionado em demo/
make test
```

Sem banco e sem chaves, o site usa o snapshot real em [`demo/`](demo) (ADR 0002).

**Modo demo de produção:** `make demo` (ou `powershell -File scripts/nicho.ps1 demo`) faz o build e sobe em http://localhost:3000 com `DEMO_MODE=true`. Depois do `npm ci` e do build, ele roda sem chaves, sem banco e sem rede. O analista responde por regras, e a busca de notícias cai para a busca lexical se o modelo de embeddings não puder ser baixado.

**Analista com LLM (opcional):** crie uma chave gratuita no [Google AI Studio](https://aistudio.google.com/apikey) ou no [console da Groq](https://console.groq.com/keys) e coloque `GEMINI_API_KEY` ou `GROQ_API_KEY` em `web/.env.local`. Para rodar localmente, use `ollama pull qwen2.5:7b`. Sem nada disso, o analista responde por regras.

Para coletar dados novos (precisa de Docker ou de uma `DATABASE_URL` do Supabase):

```bash
cp .env.example .env   # DATABASE_URL=postgresql://nicho:nicho@localhost:54329/nicho
make db-up
make migrate
cd pipeline
uv run nicho ingest precos   # 3 anos de diário + intraday de 15 min (yfinance → brapi)
uv run nicho ingest macro    # Selic, IPCA e PTAX do Banco Central
uv run nicho stats           # anomalias, GARCH(1,1) e event studies
uv run nicho ingest noticias # RSS, Google News, GDELT e documentos da CVM
uv run nicho enriquecer      # embeddings, histórias, FinBERT, extração (LLM → regras)
uv run nicho pontuar         # score de relevância e event studies de eventos
uv run nicho grafos          # correlação (MST, Louvain), conhecimento (FRE) e choques
uv run nicho briefing        # briefing do último pregão, versionado
uv run nicho export-demo     # regrava demo/
# ou tudo de uma vez: uv run nicho rodar
```

Para o site ler do banco em vez do snapshot, use `DEMO_MODE=false` e `DATABASE_URL` no `web/.env.local`. Se o banco cair, o site volta sozinho para o snapshot e mostra um aviso.

## Custo: R$ 0

Free tiers verificados na documentação oficial em 31/10/2026. Os detalhes e as fontes estão no [plano](docs/plano-de-implementacao.md#1-verificação-dos-serviços-seção-2-do-prompt).

| Serviço | Uso | Limite relevante |
|---|---|---|
| yfinance | cotações | biblioteca não oficial; uso pessoal |
| brapi.dev | fallback de cotação | 15 mil req/mês, só diário, 3 meses de histórico |
| Banco Central (SGS) | Selic, IPCA, PTAX | séries diárias: janela máxima de 10 anos por consulta |
| CVM Dados Abertos | IPE, FCA, FRE | atualização semanal |
| GDELT DOC 2.0 | notícias | 1 requisição a cada 5 s; janela de 3 meses |
| Gemini / Groq | LLM | cotas por conta (ver `config/llm.yaml`) |
| Hugging Face | modelos locais (e5-small, FinBERT-PT-BR) | download único (~1 GB), roda em CPU |
| Supabase Free | banco | 500 MB; pausa após 7 dias sem uso |
| GitHub Actions | pipeline agendado | grátis em repo público; cron desativa após 60 dias sem atividade |
| Vercel Hobby | site | uso pessoal, não comercial |

## Deploy (camadas gratuitas)

Feito por você, com as suas contas. Nenhuma chave vai para o repositório.

1. **Supabase:** crie um projeto Free e copie a connection string (pooler, porta 6543) como `DATABASE_URL`. Rode `uv run nicho migrate` e `uv run nicho rodar` uma vez a partir da sua máquina.
2. **GitHub:** em *Settings → Secrets and variables → Actions*, cadastre os secrets `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY` e (opcional) `BRAPI_TOKEN`, e a variável `COLLECTOR_USER_AGENT` (ex.: `NichoCapital/0.1 (+seu-email)`). O workflow [`pipeline.yml`](.github/workflows/pipeline.yml) roda em dias úteis às 09:00 e às 18:30 (Brasília), faz heartbeat no fim de semana e versiona `demo/` às segundas.
3. **Vercel:** importe o repositório com **Root Directory = `web`**. As variáveis são `DEMO_MODE=false`, `DATABASE_URL`, `GEMINI_API_KEY` e `GROQ_API_KEY`. Para publicar só o modo demo, basta `DEMO_MODE=true`, sem banco nem chaves.

## Documentação

- Metodologia: [estatística](docs/metodologia-estatistica.md), [notícias e relevância](docs/metodologia-noticias.md), [grafos](docs/metodologia-grafos.md) e [agente](docs/metodologia-agente.md) (também em `/metodologia`).
- Decisões: [`docs/ADRs/`](docs/ADRs) e [`docs/decisoes-de-design.md`](docs/decisoes-de-design.md).
- Demo: [`docs/roteiro-demo.md`](docs/roteiro-demo.md).
- Histórico das fases: [`docs/fases.md`](docs/fases.md).

## Licença

[MIT](LICENSE)
