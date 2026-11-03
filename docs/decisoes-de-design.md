# Decisões de design

A fonte de verdade visual é [`identidade-visual.md`](identidade-visual.md) ("Altitude"). Este arquivo registra onde o prompt do projeto e a identidade entram em conflito, e o que foi decidido. Aprovado em 31/10/2026.

Todos os valores abaixo existem como tokens em `web/src/styles/tokens.css`. Nenhum componente usa cor ou fonte literal.

Contrastes calculados pela fórmula WCAG 2.1 contra as cinco superfícies da identidade (`#111111`, `#181818`, `#1f1f1f`, `#262626`, `#323232`).

## C1 — Alta e baixa

**Conflito:** o prompt pede "verde e vermelho acessíveis para alta e baixa". A identidade proíbe cores semânticas novas.

**Decisão:**
- O significado vem **sempre** de sinal, seta e texto: `▲ +2,31%` / `▼ −1,04%` / `● 0,00%`, com `aria-label` por extenso ("alta de 2,31%"). Isso cumpre "nunca só a cor" sem depender da cor.
- A cor é um **reforço restrito a marcas de dados**: números de variação, candles, barras e células do heatmap. Nunca em botões, badges, fundos de card ou navegação.
- Tokens dessaturados para não brigar com a disciplina monocromática:

| Token | Valor | Contraste mín. (em `#323232`) | Contraste no canvas |
|---|---|---|---|
| `--color-data-up` | `#7fb89a` | 5,63:1 | 7,80:1 |
| `--color-data-down` | `#d98c8c` | 4,93:1 | 6,83:1 |

- Existe um **modo monocromático** (`data-palette="mono"` no `<html>`), em que `--color-data-up/down` viram Bone. É a identidade 100% pura.

## C2 — Tema claro

**Conflito:** o prompt pede claro e escuro "se a identidade permitir". A Altitude é só dark.

**Decisão:** a interface é **somente dark**. A única versão clara é o **CSS de impressão** (`@media print`): fundo branco, texto quase preto e títulos em serif, usada no export do briefing.

## C3 — Azul de destaque em superfícies elevadas

**Conflito:** `#2b7fff` tem 4,72:1 no canvas, mas 4,38:1 em `#1f1f1f` e 4,02:1 em `#262626`, abaixo do AA para texto.

**Decisão:**
- `--color-voltage-blue` (`#2b7fff`, original) fica para o **anel de foco e a seleção**. Elementos não textuais exigem só 3:1.
- Novo `--color-voltage-blue-text: #5c9dff` para **links em texto**: mínimo de 4,71:1 (em `#323232`) e 6,53:1 no canvas.

## C4 — Smoke como texto

**Conflito:** `#5e5d59` tem 1,95–2,86:1. A identidade o usa em placeholders e texto de baixa ênfase.

**Decisão:** Smoke só para **bordas, divisores e fundo de badge**. Placeholders e texto de baixa ênfase usam **Fog `#a4a19b`** (mínimo de 4,98:1).

## C5 — Mid Navy em ícones

**Conflito:** `#1a365d` tem 1,06–1,56:1 no escuro, invisível. A identidade só o usa sobre tiles claros.

**Decisão:** ícones em Fog. O Navy fica restrito a detalhes decorativos (borda inferior de títulos).

## C6 — Tamanho mínimo de fonte

**Conflito:** a identidade usa 8–10 px "agressivamente" em contextos densos. O prompt exige legibilidade e Lighthouse ≥ 90.

**Decisão:** mínimo de **11 px** para qualquer texto com informação. 10 px (`--text-caption`) só em ticks de eixo de gráfico, que têm equivalente acessível via `aria`. 8 e 9 px não entram nos tokens.

## C7 — Cores categóricas nos grafos

**Conflito:** comunidades Louvain pedem cores distintas; a identidade tem um só azul.

**Decisão (validada na fase 5):** comunidades por escala de cinzas (Bone → Fog → Smoke), rótulo e forma do nó, com o selecionado em azul. Se ficar ilegível com o universo completo, entra uma paleta `--viz-cat-*` de baixa saturação, restrita ao canvas do grafo, e esta seção é atualizada.

## C8 — Fotografia de montanha

**Conflito:** a imagem principal da identidade é fotografia de paisagem, e o projeto não tem fotos licenciadas.

**Decisão:** sem fotos. A única imagem é a **linha de cume em SVG** (1 px, Fog), como no hero da identidade. A partir da Fase 2, o cume é desenhado com a série real do Ibovespa. Até lá, um contorno genérico, marcado como decorativo (`aria-hidden`).

## C9 — Navegação

**Conflito:** a identidade descreve 3 links, sem sticky e sem hamburger. O produto tem 8 páginas e precisa funcionar no celular.

**Decisão:** barra de 64 px, wordmark em serif à esquerda e os 8 itens em Inter 13 px. No celular, a lista vira uma **faixa com rolagem horizontal**, ainda sem hamburger. Sem sticky. Item ativo com sublinhado de 1 px, como na identidade.

## C10 — Serif em app denso

**Decisão:** Libre Baskerville (400, nunca bold) só em títulos de página (28–36 px) e nos heros da home e do briefing (até 48 px no app; 72 px fica reservado). Todo o resto é Inter. Dados e tickers usam Inter com `tabular-nums`; Fira Code só em identificadores e trechos de query.

## C11 — Inconsistências da própria identidade

| Item | Decisão |
|---|---|
| `--shadow-subtle-4` contém um coral `rgb(232,110,88)` | Não usado e não exportado como token |
| Fallback da Libre Baskerville lista fontes sans-serif | Corrigido para `Georgia, 'Times New Roman', serif` |
| Ash `#e4e4e4` descrito como "borda secundária" | Bordas usam Slate `#262626` (padrão) e Pewter `#4b4b4b` (forte), como a própria "Quick Color Reference" indica. Ash não vira borda |
| Pontos de semáforo do "Terminal Window" | Não usados: são de screenshot de marketing |
| Tiles claros ("Workflow Tile") | Não usados no app; a interrupção clara é só da landing de marketing |

## C12 — Status e sentimento

**Decisão (seguindo a identidade):** status nunca por matiz.
- Pipeline: badge `OK` com borda 1 px Smoke; `FALHOU` com borda 2 px Bone e peso 600; `PARCIAL` com borda tracejada.
- Sentimento: texto e glifo (`+ positivo`, `· neutro`, `− negativo`), sem cor.

## Outras escolhas não definidas pela identidade

- **Fontes** carregadas por `next/font/google`, auto-hospedadas no build, sem requisição externa em runtime: funciona offline no modo demo.
- **Micro-animações:** só `opacity` e `transform`, de 120 a 200 ms, com `prefers-reduced-motion` respeitado.
- **Skeleton:** bloco em `--surface-slate-elevated` com nicho de opacidade; nada de spinner.
- **Foco:** `outline` de 2 px `--color-voltage-blue` com offset de 2 px, em todos os elementos interativos.

## Adições da fase 2 (gráficos e mapa setorial)

- **Gráfico de preço (Lightweight Charts):** linha e área em Bone; candles usam `--color-data-up/down` (C1). As cores são lidas dos tokens em runtime com `getComputedStyle`. Como a biblioteca não entende `color-mix()`, o degradê da área usa dois tokens próprios, `--chart-area-top` e `--chart-area-bottom`, definidos em rgba no `tokens.css`.
- **Mapa setorial:** cada célula mistura `--color-data-up/down` com a superfície do card em até `--heatmap-max-mix` (38%), proporcional à variação (satura em ±3%). O texto fica sempre em Bone e cada célula traz sinal, seta e "x/y em alta". Assim o significado nunca depende da cor (C1).
- **Sparkline do Ibovespa:** SVG renderizado no servidor, com linha em Bone e o fechamento anterior tracejado em Smoke (borda, não texto — C4).
- **Logo da TradingView** no canto do gráfico: mantido (`attributionLogo`), porque é a forma de atribuição prevista pela licença da biblioteca.

## Adições da fase 3 (estatística)

- **Severidade de anomalia (C12):** badge `ALTA` com borda 2 px Bone e peso 600; `MÉDIA` com borda Smoke sobre Iron Peak; `BAIXA` só contornada. Nenhuma cor.
- **Significância no event study:** "significativo a 5%" em peso 600 ou "não significativo" em Fog. É texto, não cor.
- **Gráfico de CAR (Recharts):** linha em Bone, banda do IC em `--surface-4`, linhas de referência (zero e dia do evento) em `--border-strong`. Recharts aceita `var(--token)` direto nos atributos SVG.
- **Gráfico de volatilidade:** GARCH em linha cheia Bone de 2 px; realizada de 21 dias tracejada em Fog. A diferença é de traço, não de matiz.
- **Cards em grid** usam `min-w-0`: canvas de gráfico tem largura fixa em px e, sem isso, estoura a página no celular.

## Adições da fase 4 (notícias)

- **Score de relevância:** número grande em Inter, sem cor. A decomposição usa uma barra horizontal em tons de cinza (Bone → Fog → Smoke → Pewter), separados por 1 px, mais uma tabela com fator, intensidade, peso e pontos. A barra é decorativa (`aria-hidden`); a tabela carrega a informação.
- **Fator indisponível** (centralidade antes da fase 5): quadrado só contornado e o texto "fase 5", em vez de um segmento vazio.
- **Sentimento:** glifo e texto (`+ positivo`, `· neutro`, `− negativo`), nunca cor (C12).
- **Materialidade alta:** badge com borda forte (variante `strong`); média e baixa, borda comum.
- **Marcadores no gráfico de preço:** ■ documento da CVM e ● notícia de materialidade alta, ambos em Bone acima da barra. A diferença é de forma, não de cor.
- **Filtros de notícias:** `<select>` nativos e um `range` com `accent-color` Bone. Acessíveis por teclado sem JavaScript extra.
- **Links externos** (fontes das notícias) abrem em nova aba, com aviso para leitores de tela.

## Adições da fase 5 (grafos)

- **C7 validada sem paleta categórica:** 4 níveis de cinza (`--viz-cinza-1..4`, todos ≥ 3:1 sobre o card). Quem distingue as comunidades é a legenda interativa (clicar destaca a comunidade e esmaece o resto) e a lista de membros em texto, não o tom.
- **Selecionado em azul** (`--color-voltage-blue`): é o único uso de cor no grafo, coerente com "azul só para seleção e foco".
- **Grafo de conhecimento:** tipo de nó por cinza e tamanho. Rótulo fixo só para empresas e setores; os demais aparecem ao selecionar, para não poluir.
- **Choque:** barra de impacto em Bone sobre Slate, e o caminho explicativo em texto ("Vale → correlação (ρ = 0,54) → Klabin").
- **Animação temporal:** interpolação de posições em 500 ms (ease-in-out), desligada com `prefers-reduced-motion`.

## Adições da fase 6 (agente)

- **Chat em cards, não em balões:** cada pergunta abre um card (`surface-2`, borda padrão) com a pergunta em serif, o modo em rótulo caixa-alta, os passos, a resposta, as fontes e o rodapé "Ferramentas usadas". É leitura de relatório, não conversa social, e cabe na identidade sóbria.
- **Passos ao vivo sem spinner colorido:** glifo `…` pulsando (desligado com `prefers-reduced-motion`), `✓` e `✕` em Fog. O estado também vai em texto para leitor de tela.
- **Citações `[n]`** em sobrescrito e cor de link, com título e origem no `title` e no texto acessível. A fonte sem correspondência fica em Fog, não vira link.
- **Lista de fontes em duas linhas** (título; origem · data): numa linha só, ela estourava a largura no celular.
- **Modo explícito:** "Sem LLM: resposta por regras (motivo)" ou "provedor · modelo". O usuário sempre sabe o que gerou o texto.
- **Erro** em caixa com borda 2 px Bone (`role="alert"`). Sem vermelho, coerente com C1 e C12.

## Adições da fase 7 (briefing e status)

- **Briefing como documento, não como dashboard:** coluna de 760 px, data do pregão em serif (o "hero" do briefing previsto em C10), seções com rótulo em caixa-alta e itens em texto corrido. Cada item termina com as citações `[n]` em sobrescrito.
- **Impressão (C2):** o botão "Imprimir ou salvar em PDF" e as edições anteriores somem na impressão (`data-print="hide"`), e os tokens de impressão trocam para fundo branco. É o único "tema claro" do app.
- **Fontes internas:** números calculados pelo próprio Nicho Capital (cotações, amplitude, anomalias) citam a página do ativo ou o mapa setorial como fonte e navegam no app. Fontes externas abrem em nova aba.
- **Status (C12):** OK com contorno, PARCIAL tracejado, FALHOU com borda 2 px e peso 600. O resumo em texto lista as etapas parciais e com falha, então o estado nunca depende da cor nem do badge.

## Adições da fase 8 (polimento)

- **Metodologia como prosa:** Inter 14 px com entrelinha 1,7, títulos rebaixados um nível (h1 da página → h2 por documento → h3 por seção) e sumário lateral fixo no desktop, que no celular fica no topo. Fórmulas em KaTeX, com a cor do texto herdada (sem destaque colorido). Tabelas e fórmulas largas rolam dentro do próprio bloco, não a página.
- **Fonte única:** a página renderiza `docs/metodologia-*.md` no servidor, então documentação e produto não divergem. Links relativos para outros arquivos do repositório viram texto, porque não existem no app.
