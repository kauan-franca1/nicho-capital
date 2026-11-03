# Roteiro de demo (5 minutos)

Para apresentar o Nicho Capital numa entrevista de wealth management ou investment banking. Tudo
funciona em modo demo (`make demo`), sem chaves, sem banco e sem depender da rede.

> Dica: abra o site antes da conversa e deixe as abas na ordem abaixo. Os números citados são do
> snapshot de 30/10/2026 (semana da eleição).

## 0. A pergunta de abertura (20 s)

"Antes da primeira ligação do dia, o assessor precisa saber o que mexeu na bolsa, o que é notícia
de verdade e quem mais é afetado. O Nicho Capital responde isso com dados públicos, citando a fonte de
cada afirmação, e custa zero para operar."

## 1. Briefing: o que saber antes das 10h (40 s)

`/briefing`

- Cinco seções: mercado, macro, notícias mais relevantes, documentos da CVM e anomalias.
- **Ponto a destacar:** cada item tem `[n]` e leva à fonte. É gerado só com dados do banco, sem
  LLM, então não inventa. É versionado por dia.
- "Imprimir ou salvar em PDF" gera a versão em papel, para mandar ao cliente.

## 2. Mercado e o choque da eleição (40 s)

`/` → `/ativo/MGLU3`

- Heatmap setorial, maiores altas e baixas, e Selic/IPCA/dólar.
- MGLU3 caiu −58% em 26/10. O event study mostra um CAR de −47,6% com t = −8,6: o mercado explica
  só uma parte. O GARCH mostra a volatilidade condicional disparando.
- **Pergunta que costuma vir:** "como sabe que não foi só o mercado?" O retorno anormal vem do
  modelo de mercado (β estimado fora da janela do evento), com intervalo de confiança.

## 3. Notícias que importam (40 s)

`/noticias`

- Centenas de manchetes viram histórias deduplicadas por embeddings. Uma notícia replicada em 10
  sites conta como uma história com 10 fontes.
- O score de relevância vem **decomposto**: materialidade, reação de mercado, fontes, centralidade
  no grafo e recência. Não é caixa-preta.
- O sentimento usa FinBERT-PT-BR, e há concordância medida (kappa de Cohen) entre o LLM e o modelo
  local.

## 4. Quem mais é afetado (60 s)

`/grafos`

- **Rede de correlação** (distância de Mantegna, MST, comunidades Louvain). O slider temporal mostra
  a correlação média subindo de 0,30 para 0,43 em dois anos: diversificar ficou mais difícil.
- **Grafo de conhecimento** a partir do FRE da CVM: acionistas com ≥ 5% e conselheiros em comum.
  Exemplo: BlackRock com ≥ 5% em 17 empresas, e interlocks entre B3, Bradesco e Itaú.
- **Choque:** "se o minério cair" leva a Vale, que leva a Klabin, Suzano e Gerdau, cada uma com o
  caminho que explica a exposição. A ressalva aparece na tela: mede conexão, não prevê preço.

## 5. O analista (60 s)

`/analista`

- Clique em **"Por que MGLU3 caiu?"**. A tela mostra os passos ao vivo (`explain_move`) e as
  hipóteses ordenadas, cada uma com sua confiança e a fonte.
- Mostre o rodapé **"Ferramentas usadas"**: o modelo não responde de memória, sempre chama
  ferramentas sobre os dados.
- Pergunte **"Devo comprar PETR4?"**. A resposta é fixa: não recomenda, por regra de conformidade.
- Com uma chave Gemini ou Groq no `.env`, o mesmo fluxo roda com LLM. Sem chave, as regras
  respondem, e o modo usado aparece na tela.

## 6. Bastidores (20 s)

`/status` e `/metodologia`

- O pipeline roda no GitHub Actions em dias úteis às 09:00 e às 18:30, com o histórico de execuções
  e o uso das cotas gratuitas.
- A metodologia mostra fórmulas e limitações: é o mesmo texto da pasta `docs/`.

## Perguntas prováveis

| Pergunta | Resposta curta |
|---|---|
| "Por que não usar só um LLM?" | LLM resume, mas não mede. Os números vêm de estatística (event study, GARCH, z-score robusto). O LLM só escolhe ferramentas e redige, e sem ele o produto continua funcionando. |
| "E se a fonte errar?" | Toda afirmação cita a fonte. A deduplicação mostra quantas fontes independentes confirmam a história. |
| "Isso é recomendação?" | Não. A ferramenta é educacional: há uma guarda no agente e um aviso fixo em todas as páginas. |
| "Quanto custa?" | R$ 0: camadas gratuitas verificadas na documentação de cada serviço (ver README). |
| "O que faria com mais tempo?" | Dados intradiários de melhor qualidade, cobertura de renda fixa e avaliação sistemática das respostas do agente com um conjunto de perguntas de referência. |
