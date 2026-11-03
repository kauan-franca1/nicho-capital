# Histórico das fases

Resumo do que cada fase entregou, com os números medidos ao final de cada uma. O plano original
está em [plano-de-implementacao.md](plano-de-implementacao.md), e as decisões de interface em
[decisoes-de-design.md](decisoes-de-design.md).

## Fase 1: Fundação

- Monorepo com `pipeline/` (Python 3.12 + uv) e `web/` (Next.js 16 + TypeScript), conversando só
  pelo banco (ADR 0001).
- `config/` central: universo de 47 ativos, fontes, pesos do score e cadeia de LLM.
- Postgres + pgvector local via Docker, com migrations versionadas e checksum que barra a alteração
  de uma migration já aplicada.
- Registro de execuções (`pipeline_runs`), CLI `nicho`, logs estruturados, HTTP com retentativas e
  User-Agent identificado.
- Identidade visual "Altitude" em tokens (`web/src/styles/tokens.css`); o ESLint proíbe cor literal.
  Os conflitos entre o prompt e a identidade (C1–C12) estão resolvidos em `decisoes-de-design.md`.
- CI no GitHub Actions; ADRs 0001–0004.

## Fase 2: Dados de mercado

- Cotações diárias (3 anos) e intraday de 15 min: yfinance, com brapi como fallback.
- Selic, IPCA e PTAX do SGS (Banco Central), consultados em janelas de até 10 anos.
- Home com Ibovespa, maiores altas e baixas, heatmap setorial e macro. A página de ativo usa
  Lightweight Charts.
- Snapshot `demo/` com fonte de dados dupla (snapshot ou Postgres) e fallback automático (ADR 0002).

## Fase 3: Estatística

- Anomalias: z-score robusto (mediana/MAD, só com o passado) e change points (PELT com custo O(1)).
- GARCH(1,1) com volatilidade condicional e meia-vida.
- Event study pelo modelo de mercado: CAR, teste t e IC. A janela de estimação exclui o evento.
- Achado: na eleição de 26/10/2026, Ibovespa −13,9% e MGLU3 −58% (CAR −47,6%, t = −8,6).

## Fase 4: Notícias e CVM

- RSS, Google News e GDELT, guardando só metadados, resumo e link. Documentos IPE, FCA e FRE da CVM,
  com PDFs via PyMuPDF.
- Deduplicação em histórias: embeddings e5 **centralizados** e clustering por líder.
- Sentimento com FinBERT-PT-BR. Extração estruturada por LLM com fallback por regras.
- Score de relevância decomposto: materialidade, reação de mercado ajustada, fontes, centralidade e
  recência.

## Fase 5: Grafos

- Rede de correlação: distância de Mantegna, MST, comunidades Louvain e 24 snapshots mensais. A
  correlação média subiu de 0,30 para 0,43.
- Grafo de conhecimento a partir do FRE: acionistas com ≥ 5% e administradores em comum. O CPF nunca
  é lido (LGPD).
- Propagação de choque por PageRank personalizado, com o caminho explicativo. A página `/grafos` usa
  Sigma.js.

## Fase 6: Agente

- `/analista`: tool-calling com 10 ferramentas, streaming em NDJSON, passos visíveis e fontes
  citadas.
- Cadeia Gemini → Groq → Ollama → regras: sem chave, responde por regras com as mesmas ferramentas.
- Guarda de conformidade: nunca recomenda compra ou venda. Limite de 10 perguntas por minuto por IP
  e de 500 caracteres por pergunta.

## Fase 7: Briefing e automação

- `nicho briefing`: briefing diário versionado, só com dados do banco e citação em cada item.
- `/briefing` (imprimível em PDF) e `/status` (execuções do pipeline e cotas).
- Pipeline agendado no GitHub Actions (09:00 e 18:30 em dias úteis), heartbeat no fim de semana e
  snapshot semanal.

## Fase 8: Polimento

- `/metodologia` renderiza `docs/metodologia-*.md`, com fórmulas em KaTeX.
- Roteiro de demo, README com tour e guia de deploy, e `make demo`.
- Lighthouse (mobile): acessibilidade, best practices e SEO em 100 nas páginas medidas por último.
  A performance vai de 43 a 88 conforme a página; a meta de 90 continua pendente.
- Demo publicado na Vercel: https://nicho-capital.vercel.app
- Renomeado de "Pulso B3" para **Nicho Capital** (marca, pacote `nicho`, banco).

## Testes ao final

| Parte | Testes |
|---|---|
| Pipeline | 109 (com banco) |
| Web | 80 (com banco; 74 sem) |
