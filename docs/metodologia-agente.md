# Metodologia do Analista (agente)

O Analista (`/analista`) responde perguntas sobre o mercado usando **ferramentas** sobre os
mesmos dados do resto do app. Ele nunca responde de memória sobre preços, notícias ou documentos.
Toda afirmação factual cita a fonte, e o agente não faz recomendação de compra ou venda.

## Arquitetura

```
navegador ──POST /api/agent──▶ guarda de conformidade ──▶ LLM com ferramentas ──▶ NDJSON em streaming
                 │                                           │ falhou / sem chave
                 │                                           ▼
                 └── limite por IP (10/min) e 500 caracteres   modo regras (sem LLM)
```

- **Rota:** `web/src/app/api/agent/route.ts`. Recebe `{pergunta}` e devolve `application/x-ndjson`,
  um evento por linha:
  - `modo`: LLM com provedor e modelo, regras com motivo, ou guarda;
  - `passo`: ferramenta, status rodando/ok/erro, args, resumo e ms;
  - `texto`: um delta;
  - `fontes`: lista numerada;
  - `fim`.
- **Interface:** `web/src/components/agent/`. Mostra os passos ao vivo e renderiza o texto com markdown
  mínimo e seguro (parágrafos, listas, negrito, sem HTML cru). As citações `[n]` viram links para a
  fonte. No fim vêm a lista de fontes e o rodapé recolhível "Ferramentas usadas".

## Provedores e fallback

Os três expõem a API compatível com OpenAI, com ferramentas e streaming (verificado na documentação
oficial em 31/10/2026):

| Ordem | Provedor | Endpoint | Observação |
|---|---|---|---|
| 1 | Gemini (`gemini-2.5-flash`) | `generativelanguage.googleapis.com/v1beta/openai` | camada de compatibilidade em beta |
| 2 | Groq (`llama-3.3-70b-versatile`) | `api.groq.com/openai/v1` | |
| 3 | Ollama (`qwen2.5:7b`) | `{OLLAMA_BASE_URL}/v1` | sem `tool_choice`; só entra se o modelo estiver instalado |

- Um provedor entra na cadeia se tem chave no `.env` ou, no caso do Ollama, se responde em `/api/tags`
  com o modelo instalado.
- Se um provedor falha (HTTP de erro, cota, timeout) **antes de emitir texto**, o próximo assume.
- Se todos falham, ou nenhum está configurado, entra o **modo regras**.
- Na primeira volta, `tool_choice: "required"` força o uso de ferramenta.
- O loop tem no máximo 6 voltas, e cada resultado de ferramenta é truncado em 7.000 caracteres antes
  de voltar ao modelo.

## Modo regras (sem LLM)

`deterministic.ts` classifica a intenção com expressões regulares sobre a pergunta sem acentos. Há
seis intenções, cada uma ligada às mesmas ferramentas que o LLM usaria:

| Intenção | Ferramentas |
|---|---|
| explicar | `explain_move` |
| choque | `shock_propagation` |
| setor | `get_history` por ativo + `search_news` |
| documentos | `get_filings` |
| macro | `get_macro` |
| notícias | `search_news` |

A resposta sai de modelos de texto. É o que roda offline, sem chaves (`DEMO_MODE`), e é o que os
testes ponta a ponta cobrem com o snapshot real.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `get_quote`, `get_history` | último fechamento e variação; retorno em 1d, 1s, 1m, 3m, 6m, 1a ou 3a |
| `search_news` | busca semântica (e5-small q8 via transformers.js, vetores **centralizados** como no pipeline), com fallback lexical se o modelo não carregar em 1,5 s |
| `get_filings` | documentos IPE da CVM (fato relevante, comunicado) |
| `run_event_study` | modelo de mercado, CAR e teste t (porte em TS do pipeline) |
| `query_graph`, `shock_propagation` | vizinhos no grafo; ranking de exposição por PPR com o caminho explicativo |
| `get_macro` | Selic, IPCA e PTAX do SGS (cita o SGS como fonte) |
| `explain_move` | ver abaixo |
| `get_briefing` | disponível na fase 7 |

### `explain_move`: hipóteses ranqueadas

Para um pregão, a ferramenta calcula:

- o retorno do ativo e o do Ibovespa;
- o retorno anormal pelo modelo de mercado (β por OLS em [−250, −11] pregões, mínimo de 120 observações, teste t);
- a média dos pares do setor;
- as anomalias do dia;
- as histórias de notícias na janela [−3, +1] dias.

As hipóteses saem por regra explícita:

1. **Acompanhou o mercado** (alta), se o retorno anormal não é significativo a 5%. Se é
   significativo: **mercado explica só parte** (média).
2. **Movimento do setor**, se os pares andaram no mesmo sentido com ≥ 40% da magnitude. Fica alta
   com ≥ 70% e média abaixo disso.
3. **Notícia ou documento da empresa**:
   - alta, se o retorno anormal é significativo e o score ≥ 60;
   - média, se o score ≥ 50;
   - baixa, nos outros casos.
4. **Fato macro ou de mercado** (média), se há história macro ou com 3+ empresas na janela.
5. **Sem explicação nos dados** (baixa), se há retorno anormal significativo e nenhuma notícia.

**Direção:** a ferramenta recebe a direção perguntada ("caiu" → `queda`). Sem data explícita, se o
último pregão foi no sentido oposto, ela explica o maior movimento no sentido perguntado nos últimos
5 pregões e avisa isso na resposta. Exemplo: "Por que MGLU3 caiu?" com o último pregão em +4,29%
explica a queda de −58,23% em 26/10/2026.

## Conformidade e limites

- **Guarda de recomendação:** pedidos como "devo comprar", "preço-alvo" ou "compro ou vendo"
  recebem uma resposta fixa, sem chamar o LLM nem as ferramentas.
- **Prompt de sistema:**
  - pt-BR;
  - ferramentas sempre;
  - citar `[n]`;
  - "não encontrei dados" quando faltar dado;
  - sem recomendação;
  - choque é exposição, não previsão;
  - até cerca de 180 palavras.
- **Entrada e uso:** a entrada aceita até 500 caracteres (413 acima disso). O limite é de 10
  perguntas por minuto por IP (429 com `Retry-After`). Em serverless, o estado do limite é por
  instância: é uma proteção de cota, não um WAF.
- **Fatores fora do universo** (minério, petróleo, celulose, juros) são aproximados por uma empresa
  ou setor exposto (Vale, Petrobras, Suzano, setor financeiro). A aproximação é dita na resposta.

## Limitações

- O modo LLM foi verificado com mocks do stream SSE: texto, montagem de argumentos fatiados e erro
  HTTP que aciona o fallback. Ainda não foi exercitado de ponta a ponta com chave real.
- A busca semântica depende de baixar o e5-small (cerca de 30 MB) na primeira consulta. Offline,
  cai para a busca lexical.
