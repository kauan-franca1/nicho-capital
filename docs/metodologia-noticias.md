# Metodologia: notícias, CVM e relevância

Base da página `/metodologia` (fase 8). Parâmetros em [`config/nlp.yaml`](../config/nlp.yaml) e [`config/scoring.yaml`](../config/scoring.yaml); código em [`pipeline/nicho/ingest`](../pipeline/nicho/ingest), [`enrich`](../pipeline/nicho/enrich), [`extract`](../pipeline/nicho/extract) e [`scoring`](../pipeline/nicho/scoring).

## Coleta

| Fonte | Como | Limites e ressalvas |
|---|---|---|
| RSS de 8 portais | `feedparser`, a cada execução | Só os itens recentes de cada feed |
| Google News RSS | 1 busca por empresa (`"Nome" OR TICKER`), 3 s entre buscas | Sem documentação oficial nem SLA |
| GDELT DOC 2.0 | empresas agrupadas com OR, 5 s entre consultas | A API responde 429 com frequência; vira aviso, não erro |
| CVM: IPE | ZIP anual, filtro por CNPJ e categoria (Fato Relevante, Comunicado ao Mercado) | **Atualização semanal**: um fato de hoje pode ainda não estar no arquivo |
| CVM: PDFs | link do RAD/ENET, texto com PyMuPDF (até 6.000 caracteres) | PDFs escaneados não têm texto |

- **O que guardamos:** só título, link, fonte, data e o resumo que a própria fonte publica. Nada de texto integral nem de scraping (prompt §5.1 e §10).
- **Mapeamento ticker → CNPJ:** vem do FCA da CVM (`Codigo_Negociacao`). Três empresas têm código inválido no próprio FCA (BTG "000000", CSN "4030", Marfrig/MBRF "ADR"); para elas, o CNPJ é declarado em `universe.yaml`.
- **Menções a empresas:** casamento pelos apelidos de `universe.yaml`, ignorando acentos mas **diferenciando maiúsculas**. Assim "Localiza" (empresa) não casa com "localiza" (verbo), nem "Vivo" com "vivo".

## Deduplicação em histórias

- **Embeddings:** `intfloat/multilingual-e5-small` (MIT, 384 dimensões, CPU), com o prefixo `passage:` que o modelo exige.
- **Agrupamento guloso em ordem cronológica:** cada item entra na história ativa mais parecida (cosseno com o centroide ≥ 0,93, a até 72 h); senão, abre uma nova.
- **Calibração do limiar:** o e5 concentra os cossenos entre 0,7 e 1,0. Duas manchetes sem relação deram 0,86 e uma paráfrase deu 0,95; por isso o limiar é bem mais alto que o "natural" 0,8.
- **Fontes independentes:** o número de veículos distintos numa história é sinal de relevância.

## Sentimento

- **Modelo:** `lucas-leme/FinBERT-PT-BR` (Apache-2.0), local, sobre título + resumo.
- **Rótulos:** verificados no `config.json` do modelo (0 = positivo, 1 = negativo, 2 = neutro). Score = P(positivo) − P(negativo), de −1 a +1.
- **Cuidado técnico:** o pipeline do `transformers` aplicaria sigmoide por classe. Forçamos softmax para obter uma distribuição que soma 1.
- **Concordância LLM × FinBERT:** kappa de Cohen sobre os itens que têm os dois rótulos, registrado a cada execução (tabela `sentiment_agreement`). Só existe quando há extrações por LLM.

## Extração estruturada

- **Prompt:** versionado em [`pipeline/prompts/extracao/v1.md`](../pipeline/prompts/extracao/v1.md), com few-shot em português e regras explícitas de ancoragem ("extraia apenas o que está escrito; nunca invente").
- **Cadeia de provedores:** Gemini → Groq → Ollama, todos em modo JSON.
  - Cota por minuto (janela deslizante) e por dia (tabela `quota_usage`), configurável em `llm.yaml`.
  - O limite de itens por execução vale **só para chamadas ao LLM**.
- **Validação:** Pydantic. JSON inválido ganha uma tentativa de reparo; se falhar de novo, vira `extraction_failed`, sem travar o pipeline.
- **Cache:** por hash do texto + versão do prompt. O mesmo texto nunca gasta cota duas vezes.
- **Âncora final:** um ticker que não é do universo nunca passa, mesmo que o LLM o devolva.
- **Sem nenhum LLM disponível** (sem chave ou Ollama desligado), a extração é **por regras**: palavras-chave → tipo de evento, materialidade derivada do tipo e sentimento do FinBERT, com confiança 0,3. Cada história mostra qual método foi usado.

## Score de relevância (0–100)

$$\text{score} = 100 \cdot \frac{\sum_i w_i f_i}{\sum_{i\ \text{disponível}} w_i}, \qquad f_i \in [0, 1]$$

| Fator | Definição | Peso |
|---|---|---|
| Materialidade | média de (materialidade do LLM → 1/3, 2/3, 1) e (peso do tipo de evento) | 0,25 |
| Reação do mercado | 0,7 · min(\|z_ret\|, 6)/6 + 0,3 · min(z_vol⁺, 6)/6, no pregão do evento; z_ret é do retorno **ajustado ao mercado** (ativo − Ibovespa) | 0,20 |
| Fontes independentes | ln(1 + n) / ln(6), satura em 5 fontes | 0,15 |
| Intensidade do sentimento | \|sentimento médio\| | 0,10 |
| Novidade | 1 − maior cosseno com histórias dos 7 dias anteriores | 0,10 |
| Recência | 0,5^(horas / 24) | 0,10 |
| Centralidade no grafo | fase 5 | 0,10 |

- **Fator indisponível:** sai da soma e os pesos são renormalizados. Exemplos: a centralidade antes da fase 5; a reação de mercado sem ticker ou sem preço.
- **Pregão do evento:** notícia publicada depois das 18h de Brasília conta para o pregão seguinte. A regra é a mesma no pipeline e no site.
- **Decomposição:** cada componente é guardado com fator, peso efetivo e pontos. A interface mostra "por que é relevante" somando exatamente o score.

## Event studies de documentos e notícias

O modelo de mercado da fase 3 é aplicado automaticamente:
- a cada **fato relevante** da CVM;
- a cada história de **materialidade alta** com ticker identificado.

Histórias que já contêm um documento da CVM não geram estudo duplicado.

## Limitações

- **Janela curta:** os RSS trazem só dias recentes e o GDELT, no máximo 3 meses. Testes de sentimento × retorno (Spearman, Granger, Benjamini-Hochberg) ficam para quando houver histórico suficiente; com 3 semanas, seriam ruído.
- **Google News:** as manchetes podem vir reescritas pelo agregador, e o link é um redirecionamento do Google.
- **Extração por regras:** não identifica pessoas nem valores, e erra o tipo de evento em textos ambíguos.
