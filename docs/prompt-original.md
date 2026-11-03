# Prompt para o Claude Code — Projeto "Pulso B3"

> Cole todo o conteúdo abaixo no Claude Code, numa pasta vazia que já contenha o arquivo `docs/identidade-visual.md`.
> Substitua "Pulso B3" pelo nome que preferir.

---

## 0. Seu papel

Você é um engenheiro de software sênior e cientista de dados quantitativo. Você vai construir, do zero e de ponta a ponta, uma plataforma de inteligência de mercado sobre a B3. O projeto é um **portfólio pessoal** que eu vou apresentar em processos seletivos para **Executive & Sales em um banco global de wealth management e investment banking**.

O resultado precisa:
1. **Impressionar tecnicamente.** Deve ter arquitetura limpa, IA aplicada de verdade, teoria dos grafos, estatística rigorosa e extração estruturada de informação.
2. **Falar a língua de negócio.** Cada tela precisa responder a uma pergunta que um banker ou assessor faria antes de ligar para um cliente.
3. **Custar exatamente R$ 0,00.** Isso vale para operação e hospedagem, sem exceção. Veja a seção 2.
4. **Funcionar ao vivo numa entrevista.** Também deve ter um modo demo offline caso a internet ou alguma API falhe.

Antes de escrever qualquer código:
- leia este prompt inteiro;
- leia `docs/identidade-visual.md`;
- apresente um **plano de implementação em fases**, com a arquitetura, as decisões técnicas e os riscos;
- aguarde a minha confirmação.

Depois de aprovado, implemente fase por fase. Ao final de cada fase:
- rode os testes;
- rode a aplicação e verifique que funciona;
- me mostre um resumo curto do que foi feito.

---

## 1. O produto

**Pulso B3** é um "analista de mercado com IA" que:

1. **Lê a bolsa.** Coleta cotações, volumes e indicadores dos ativos do Ibovespa e detecta movimentos anormais com estatística.
2. **Procura notícias relevantes.** Varre notícias, fatos relevantes da CVM e dados macro, e mostra apenas o que realmente importa. Para isso, deduplica, extrai entidades e eventos, mede o sentimento e calcula um score de relevância.
3. **Conecta os pontos com grafos.** Monta redes de correlação entre ativos e um grafo de conhecimento com empresas, pessoas, setores e eventos, mostrando como um choque se propaga.
4. **Explica em linguagem natural.** Um agente de IA responde perguntas como as abaixo, sempre citando as fontes:
   - "Por que PETR4 caiu hoje?"
   - "Quais empresas são mais afetadas se o minério cair?"
   - "Resuma o que aconteceu com bancos esta semana."
5. **Gera um briefing diário automático.** É uma página "o que um assessor precisa saber hoje antes das 10h".

**Público da demo:** executivos de vendas e gestores de um banco. Eles valorizam clareza, velocidade, credibilidade e conexão com geração de negócio.

---

## 2. Restrição absoluta: 100% gratuito

- **Nada que exija cartão de crédito**, plano pago ou trial que expire.
- Use apenas **free tiers permanentes**, bibliotecas open source e dados públicos.
- **Antes de integrar qualquer serviço ou API, verifique a documentação oficial atual.** Confirme que o free tier existe e quais são os limites. Free tiers mudam com frequência. **Não invente endpoints nem parâmetros.** Se algo não puder ser confirmado, me avise e proponha uma alternativa.
- Todo provedor externo deve ficar atrás de uma **camada de abstração com fallback**. Se um provedor falhar ou estourar a cota, o sistema degrada com elegância e nunca quebra.
- O projeto também precisa rodar **100% localmente**, sem nenhuma chave, usando Ollama e os dados de demo em cache.

### Stack gratuita sugerida
Valide cada item. Se encontrar algo melhor e também gratuito, proponha com justificativa.

| Camada | Escolha principal | Fallback |
|---|---|---|
| Cotações B3 | `yfinance` (tickers `.SA`) | brapi.dev (free tier, verificar limites) |
| Macro | API SGS do Banco Central (Selic, IPCA, PTAX; confirmar códigos das séries) | — |
| Fatos relevantes | Portal de Dados Abertos da CVM (dataset IPE; FCA/FRE para cadastro, administradores e composição de capital) | — |
| Notícias | RSS públicos de portais financeiros brasileiros, Google News RSS por ticker ou empresa, GDELT DOC API | — |
| LLM | Google Gemini API (free tier, modelo Flash) | Groq (free tier) → Ollama local |
| Embeddings | `sentence-transformers` multilíngue local (ex.: `intfloat/multilingual-e5-small`) | — |
| Sentimento financeiro PT-BR | FinBERT-PT-BR no Hugging Face (verificar disponibilidade) | classificação via LLM |
| Banco de dados | Supabase free (Postgres + pgvector) | SQLite/DuckDB local |
| Pipeline agendado | GitHub Actions com cron (repositório público = gratuito) | execução local via `make` |
| Frontend | Next.js (App Router) + TypeScript na Vercel Hobby | `next dev` local |
| Bot de alertas (opcional) | Telegram Bot API | — |

Observações:
- Supabase free pausa projetos inativos. O cron do GitHub Actions deve escrever no banco regularmente para mantê-lo ativo. Documente isso.
- Dados do Yahoo têm atraso. A interface deve sempre exibir **"dados com atraso, não é tempo real"** e o horário da última atualização.

---

## 3. Identidade visual

- A fonte de verdade do visual é **`docs/identidade-visual.md`**. Leia esse arquivo inteiro antes de criar qualquer componente.
- Converta a identidade em **design tokens**: cores, tipografia, espaçamentos, raios, sombras e estados.
  - Use CSS variables + configuração do Tailwind.
  - Crie um único arquivo de tokens. Nenhuma cor ou fonte pode ficar hardcoded nos componentes.
- Suporte a **tema claro e escuro**, se a identidade permitir. Se o arquivo não definir algo, proponha uma escolha coerente e registre em `docs/decisoes-de-design.md`.
- A estética deve ser de **terminal financeiro moderno**:
  - densidade de informação alta, mas legível;
  - números tabulares (`font-variant-numeric: tabular-nums`);
  - verde e vermelho acessíveis para alta e baixa, nunca usando só a cor para transmitir significado;
  - micro-animações discretas.
- Acessibilidade: contraste WCAG AA, navegação por teclado e `aria-labels` nos gráficos.
- Layout responsivo. A demo será em desktop, mas precisa funcionar no celular.
- **Não use logotipo, nome ou marca de nenhum banco real.** É um projeto pessoal e não pode parecer um produto oficial de nenhuma instituição.

---

## 4. Arquitetura

```
┌────────────────────────── GitHub Actions (cron) ──────────────────────────┐
│  pipeline/ (Python)                                                       │
│  ingest → normalize → dedupe → extract (LLM) → enrich (sentiment, embed)  │
│  → stats (anomalias, event study) → graphs (correlação, conhecimento)     │
│  → relevance score → daily briefing                                       │
└───────────────────────────────┬───────────────────────────────────────────┘
                                ▼
                 Supabase Postgres + pgvector  (ou SQLite/DuckDB local)
                                ▼
┌────────────────────── Vercel (Next.js, TypeScript) ───────────────────────┐
│  Páginas + API Routes                                                     │
│  /api/agent → agente com tool-calling (Gemini → Groq → Ollama)            │
│  tools: get_quote, get_history, search_news, get_filings,                 │
│         run_event_study, query_graph, get_macro, explain_move             │
└───────────────────────────────────────────────────────────────────────────┘
```

Princípios:
- **Separação clara:** o pipeline de dados é Python e o produto é TypeScript. Eles se comunicam apenas pelo banco, com um schema versionado em migrations.
- **Idempotência:** rodar o pipeline duas vezes não pode duplicar dados. Use hash de conteúdo e upserts.
- **Configuração central:** `config/universe.yaml` (tickers, setores, empresa, apelidos para busca de notícias), `config/sources.yaml` (feeds RSS) e `.env` para as chaves.
- **Observabilidade:**
  - logs estruturados;
  - tabela `pipeline_runs` com status, duração, contagens e erros;
  - página "/status" no frontend.

---

## 5. Módulos do pipeline (Python 3.11+)

Use `uv` ou `poetry`, `pydantic` para schemas, `httpx` com retry e backoff (`tenacity`), cache local e rate limiting respeitoso.

### 5.1 Ingestão
- **Cotações:**
  - histórico diário de 3 anos e intraday recente (quando disponível) dos componentes do Ibovespa e do próprio índice (`^BVSP`);
  - comece com um universo configurável de ~40 tickers líquidos, expansível.
- **Macro:** Selic, IPCA, PTAX e, opcionalmente, outras séries relevantes do SGS.
- **CVM:**
  - baixe o índice IPE e filtre fatos relevantes e comunicados dos tickers do universo;
  - baixe o PDF do documento e extraia o texto com `pymupdf` ou `pdfplumber`;
  - use o FCA/FRE para administradores, controladores e composição acionária, que alimentam o grafo.
- **Notícias:**
  - RSS e Google News RSS por empresa e ticker, mais GDELT;
  - **armazene apenas título, link, fonte, data e o resumo/snippet que o feed fornecer;**
  - **não faça scraping de texto integral de sites com paywall nem republique artigos;**
  - respeite robots.txt e termos de uso.

### 5.2 Normalização e deduplicação
- Normalize datas para `America/Sao_Paulo`.
- **Deduplique notícias quase idênticas** com embeddings e similaridade de cosseno, com threshold configurável. Agrupe-as em "histórias", onde uma história reúne várias fontes. O número de fontes cobrindo a mesma história é um sinal de relevância.

### 5.3 Extração estruturada com IA (o núcleo de "extração de metadados")
Para cada notícia e fato relevante, o LLM retorna **JSON validado por Pydantic**:

```json
{
  "tickers": ["PETR4"],
  "empresas": ["Petrobras"],
  "pessoas": [{"nome": "...", "cargo": "..."}],
  "setores": ["Petróleo e Gás"],
  "tipo_evento": "resultado | dividendos | M&A | guidance | regulatório | rating | troca_de_gestao | emissao | recompra | judicial | macro | outro",
  "valores_monetarios": [{"valor": 0, "moeda": "BRL", "contexto": "..."}],
  "sentimento": {"label": "positivo|neutro|negativo", "score": 0.0},
  "materialidade_estimada": "baixa|media|alta",
  "horizonte": "curto|medio|longo",
  "resumo_1_linha": "...",
  "confianca": 0.0
}
```

- **Prompts versionados** em `pipeline/prompts/`, com few-shot em português.
- **Validação e reparo:** se o JSON vier inválido, tente reparar uma vez. Se falhar de novo, marque como `extraction_failed`, sem travar o pipeline.
- **Cache por hash de conteúdo**, para nunca gastar cota do LLM duas vezes com o mesmo texto.
- **Controle de cota:** fila com limite de requisições por minuto e por dia, configurável. Quando a cota acabar, use o fallback.
- **Ancoragem:** o LLM só pode extrair o que está no texto. Inclua no prompt uma instrução explícita contra inventar dados.

### 5.4 Sentimento
- Use o FinBERT-PT-BR local como modelo principal. Compare com o sentimento do LLM numa amostra e registre a concordância (kappa de Cohen) na página de metodologia.

### 5.5 Estatística (precisa ser rigorosa e explicável)
- **Retornos e volatilidade:**
  - log-retornos e volatilidade realizada;
  - GARCH(1,1) com a biblioteca `arch` para volatilidade condicional.
- **Detecção de anomalias:**
  - z-score robusto (mediana/MAD) de retorno e volume contra janela móvel;
  - change-point detection com `ruptures`;
  - classifique cada anomalia por severidade.
- **Event study clássico:**
  - modelo de mercado (OLS do ativo contra o Ibovespa numa janela de estimação);
  - retorno anormal (AR) e acumulado (CAR) em janelas como [-1,+1] e [0,+5];
  - teste t e intervalo de confiança;
  - aplique automaticamente a cada fato relevante e notícia de alta materialidade.
- **Sentimento × retorno:**
  - correlação de Spearman e teste de causalidade de Granger com a ressalva adequada;
  - correção de múltiplas comparações (Benjamini-Hochberg).
- **Honestidade estatística:**
  - nada de look-ahead bias;
  - qualquer backtest deve ser walk-forward;
  - mostre tamanho de amostra e intervalos;
  - escreva as limitações na página de metodologia.

### 5.6 Grafos
Use `networkx`, com `python-louvain` ou o Louvain nativo do networkx.

1. **Rede de correlação de ativos:**
   - matriz de correlação de log-retornos (janela móvel de 90 dias);
   - distância de Mantegna `d = sqrt(2(1-ρ))`;
   - **Minimum Spanning Tree**;
   - comunidades (Louvain);
   - centralidades (degree, betweenness, eigenvector);
   - mostre como a estrutura muda ao longo do tempo, com snapshots mensais e animação no frontend.
2. **Grafo de conhecimento:**
   - nós: Empresa, Pessoa, Setor, Evento e Notícia;
   - arestas: `ADMINISTRA`, `CONTROLA`, `PERTENCE_A`, `MENCIONADA_EM`, `CO_MENCIONADA_COM` (com peso e decaimento temporal), `AFETA`;
   - fontes: dados CVM + extração do LLM.
3. **Propagação de choque:**
   - dado um nó (ex.: "minério de ferro" ou "VALE3"), estime o impacto nos vizinhos;
   - use personalized PageRank e pesos de correlação;
   - devolva um ranking explicável.
4. **(Opcional, se houver tempo) Previsão de ligações:** node2vec e similaridade para sugerir conexões não óbvias entre empresas. Marque como experimental.

Exporte os grafos em formato consumível pelo frontend (nós e arestas em JSON, com atributos de layout pré-calculados).

### 5.7 Score de relevância
Para cada história, calcule um score de 0 a 100, **decomponível e explicável**. A interface mostra "por que isso é relevante" com a contribuição de cada fator:
- materialidade (LLM) e tipo de evento;
- intensidade do sentimento;
- número de fontes independentes;
- reação de mercado associada: retorno e volume anormais do ticker no mesmo dia;
- centralidade da empresa no grafo;
- novidade (distância do embedding para histórias recentes);
- decaimento temporal.

Os pesos ficam em configuração e são documentados.

### 5.8 Briefing diário
Rode antes da abertura do pregão (cron em UTC, convertendo de Brasília). O LLM gera um briefing **usando apenas dados do banco, com citação de fonte em cada afirmação**:
- o que mexeu no mercado ontem;
- top 5 histórias por relevância;
- ativos com anomalias;
- agenda (resultados e dividendos, quando houver dados);
- macro;
- "3 pontos de conversa com clientes".

Salve o briefing versionado no banco.

### 5.9 Testes do pipeline
- `pytest` com fixtures de dados gravados (VCR/cassettes ou JSON). **Os testes não podem depender de rede.**
- Testes unitários de estatística contra valores conhecidos, por exemplo um event study com dados sintéticos de efeito conhecido.
- `ruff`, `mypy`, cobertura mínima de 70% nos módulos de estatística, grafos e score.

---

## 6. Agente de IA ("Analista")

- Implemente na API Route do Next.js (`/api/agent`) com **tool-calling**. O agente **nunca responde de memória sobre dados de mercado**: ele sempre chama ferramentas.
- Ferramentas mínimas:
  - `get_quote(ticker)`
  - `get_history(ticker, periodo)`
  - `search_news(query, ticker?, desde?)`, com busca semântica via pgvector + filtro
  - `get_filings(ticker, desde?)`
  - `run_event_study(ticker, data_evento)`
  - `query_graph(no, tipo, profundidade)`
  - `shock_propagation(no)`
  - `get_macro(serie, periodo)`
  - `get_briefing(data)`
- **Fluxo `explain_move(ticker, data)`:** busca o retorno e o volume anormais, as notícias e fatos do período, o comportamento do setor e do índice, e devolve uma explicação estruturada com as hipóteses ranqueadas e o nível de confiança.
- **Regras do agente:**
  - responde em português;
  - cita fontes com link em toda afirmação factual;
  - diz "não encontrei dados" quando for o caso;
  - **não faz recomendação de compra ou venda.** Se pedirem, explica que é uma ferramenta informativa;
  - mostra no rodapé as ferramentas chamadas, de forma transparente e colapsável.
- **Streaming** da resposta e exibição dos passos ("consultando notícias…", "calculando retorno anormal…").
- **Fallback de provedor:** Gemini → Groq → Ollama, com mensagem amigável quando nenhum estiver disponível.
- **Proteções:** rate limit por IP na rota, para proteger a cota gratuita, e tamanho máximo de entrada.
- **Sugestões de perguntas** clicáveis na tela inicial do chat.

---

## 7. Frontend (Next.js + TypeScript)

Stack:
- Tailwind + shadcn/ui, adaptados aos tokens da identidade;
- **TradingView Lightweight Charts** (open source) para preços;
- Recharts ou visx para gráficos estatísticos;
- **Sigma.js + graphology** (ou react-force-graph) para grafos;
- TanStack Query para os dados.

Páginas:
1. **/ — Visão geral do mercado:**
   - Ibovespa, maiores altas e baixas, heatmap setorial;
   - anomalias do dia;
   - top histórias por relevância;
   - macro (Selic, IPCA, dólar);
   - selo de horário da última atualização.
2. **/ativo/[ticker]:**
   - gráfico com marcadores de eventos (fatos relevantes e notícias) sobrepostos ao preço;
   - volatilidade GARCH;
   - painel de anomalias;
   - event studies dos últimos eventos, com gráfico de CAR e intervalo de confiança;
   - notícias ranqueadas;
   - vizinhos no grafo;
   - botão "Explicar movimento de hoje".
3. **/noticias:**
   - feed de histórias deduplicadas;
   - filtros por setor, tipo de evento, sentimento e relevância mínima;
   - cada card mostra a decomposição do score e as fontes.
4. **/grafos:**
   - aba "Correlação": MST interativo, cores por comunidade, slider temporal com animação;
   - aba "Conhecimento": busca de nó, expansão por clique, filtro por tipo de relação;
   - aba "Choque": seleciona um nó e vê o ranking de impacto propagado.
5. **/analista:** chat com o agente.
6. **/briefing:** briefing do dia e histórico, com botão de exportar para PDF/print com CSS de impressão.
7. **/metodologia:**
   - explica cada técnica em linguagem acessível, com fórmulas em KaTeX;
   - inclui limitações e o diagrama da arquitetura.
   
   **Esta página é crucial para a entrevista.**
8. **/status:** saúde do pipeline, últimas execuções, uso estimado de cota.

Requisitos de UX:
- tempo de carregamento rápido (ISR/cache onde fizer sentido);
- skeletons em vez de spinners;
- estados vazios e de erro bem desenhados;
- disclaimer fixo e discreto: "Ferramenta educacional. Não constitui recomendação de investimento. Dados públicos com atraso."

---

## 8. Modo demo (obrigatório)

- `DEMO_MODE=true` faz a aplicação inteira funcionar **sem internet e sem chaves**, usando um snapshot de dados reais coletados e versionados em `demo/`.
- No modo demo, o agente usa respostas pré-gravadas para as perguntas sugeridas ou o Ollama, se disponível.
- Crie um script `make demo` que sobe tudo localmente com um comando.

---

## 9. Estrutura do repositório

```
/
├── README.md                 # pitch + arquitetura (mermaid) + screenshots + como rodar
├── docs/
│   ├── identidade-visual.md  # (fornecido por mim)
│   ├── decisoes-de-design.md
│   ├── ADRs/                 # decisões de arquitetura
│   └── roteiro-demo.md       # roteiro de apresentação de 5 minutos
├── config/ (universe.yaml, sources.yaml, scoring.yaml)
├── pipeline/ (Python: ingest/, extract/, stats/, graphs/, scoring/, briefing/, prompts/, tests/)
├── db/migrations/
├── web/ (Next.js)
├── demo/ (snapshot de dados)
├── .github/workflows/ (pipeline.yml, ci.yml)
├── .env.example
├── Makefile
└── LICENSE (MIT)
```

---

## 10. Segurança, compliance e ética

- Nenhum segredo commitado. Use `.env.example` documentado e secrets do GitHub e da Vercel.
- Apenas dados públicos.
- Nada de dados pessoais além de nomes e cargos de administradores já divulgados publicamente pela CVM, em conformidade com a LGPD.
- Respeite os termos de uso e os rate limits de todas as fontes. Identifique o User-Agent do coletor.
- Notícias: apenas metadados + snippet + link para a fonte original.
- Disclaimer de "não é recomendação de investimento" visível em todo o produto.

---

## 11. Plano de fases (ajuste se necessário, mas mantenha entregas funcionais a cada fase)

1. **Fundação:** repositório, tooling, schema do banco, config, CI, tokens de design a partir da identidade visual, layout base do frontend.
2. **Dados de mercado:** ingestão de cotações e macro, página inicial e página de ativo com gráficos.
3. **Estatística:** anomalias, GARCH, event study, com testes.
4. **Notícias e CVM:** ingestão, deduplicação, extração por LLM, sentimento, score de relevância, página de notícias.
5. **Grafos:** correlação/MST/comunidades, grafo de conhecimento, propagação de choque, página de grafos.
6. **Agente:** tool-calling, streaming, fallback, página do analista.
7. **Briefing + automação:** GitHub Actions agendado, briefing diário, página de status.
8. **Polimento para entrevista:**
   - modo demo;
   - página de metodologia;
   - README com screenshots e GIF;
   - `docs/roteiro-demo.md`;
   - revisão de performance e acessibilidade;
   - deploy final na Vercel.

---

## 12. Critérios de aceite

- [ ] `make demo` sobe tudo localmente, sem chaves e sem internet.
- [ ] O pipeline roda no GitHub Actions sem erro e é idempotente.
- [ ] Custo total: R$ 0, com todos os serviços documentados no README e seus limites de free tier.
- [ ] O agente responde "Por que [TICKER] se moveu hoje?" com fontes citadas e passos visíveis.
- [ ] Toda notícia exibida mostra por que é relevante (score decomposto).
- [ ] O event study tem teste unitário com efeito sintético conhecido e passa.
- [ ] Os grafos são interativos e performáticos com o universo completo.
- [ ] A identidade visual de `docs/identidade-visual.md` é aplicada via tokens, sem valores hardcoded.
- [ ] A página de metodologia explica todas as técnicas e limitações.
- [ ] Lighthouse ≥ 90 em performance e acessibilidade na página inicial.
- [ ] O README abre com um parágrafo de pitch de negócio, depois a arquitetura.

---

## 13. O que NÃO fazer

- Não use nenhum serviço pago ou que peça cartão.
- Não invente endpoints, parâmetros ou códigos de séries. Verifique na documentação.
- Não deixe o LLM responder sobre dados de mercado sem ferramenta.
- Não faça scraping de conteúdo com paywall nem republique artigos.
- Não use marca ou logotipo de nenhuma instituição financeira real.
- Não gere "previsões de preço" vendidas como certeza. Se houver qualquer modelo preditivo, ele deve vir com validação walk-forward e aviso explícito.
- Não pule testes nem marque uma fase como concluída sem rodar a aplicação.

---

**Comece agora:** leia `docs/identidade-visual.md`, verifique os free tiers atuais das ferramentas da seção 2 e me apresente o plano detalhado da Fase 1 e a visão geral das demais fases, com riscos e alternativas. Aguarde minha aprovação antes de codificar.
