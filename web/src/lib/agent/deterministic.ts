import { formatDateBr, formatMonthBr, formatNumber } from "@/lib/format";
import { universe } from "@/lib/universe";

import { nomeDoTicker, resolverSetor, resolverTicker, semAcento } from "./entities";
import type { Hipotese } from "./tools";

/**
 * Modo sem LLM: roteia a pergunta por intenção para as mesmas ferramentas e escreve a resposta
 * com modelos de texto. É o que roda offline, sem chaves (prompt §8), e quando todos os
 * provedores estão fora do ar ou sem cota.
 */

export type Plano =
  | { intencao: "explicar"; ticker: string; direcao: "queda" | "alta" | null }
  | { intencao: "choque"; no: string }
  | { intencao: "setor"; setor: string; dias: number }
  | { intencao: "documentos"; ticker: string }
  | { intencao: "macro" }
  | { intencao: "noticias"; consulta: string; ticker: string | null }
  | { intencao: "ajuda" };

export function planejar(pergunta: string): Plano {
  const q = semAcento(pergunta);
  const ticker = resolverTicker(pergunta);
  const setor = resolverSetor(pergunta);
  if (/\b(afetad|expost|choque|impacto|contagi|se (o|a|os|as)? ?\w+ cair|se \w+ cair)/.test(q)) {
    return { intencao: "choque", no: pergunta };
  }
  if (
    ticker &&
    /\b(por ?que|porque|caiu|subiu|cai|sobe|despenc|disparou|dispara|mexeu|moveu|queda|alta|movimento)/.test(
      q,
    )
  ) {
    const direcao = /\b(caiu|cai|despenc|queda|recu)/.test(q)
      ? "queda"
      : /\b(subiu|sobe|disparou|dispara|alta)/.test(q)
        ? "alta"
        : null;
    return { intencao: "explicar", ticker, direcao };
  }
  if (/\b(selic|ipca|inflacao|dolar|ptax|juros|macro|cambio)/.test(q)) return { intencao: "macro" };
  if (ticker && /\b(fato|fatos relevantes|comunicado|cvm|documento)/.test(q))
    return { intencao: "documentos", ticker };
  if (setor && !ticker && /\b(resum|aconteceu|como foi|como esta|semana|hoje|mes)/.test(q)) {
    return { intencao: "setor", setor, dias: /\bmes\b/.test(q) ? 21 : /\bhoje\b/.test(q) ? 1 : 5 };
  }
  if (ticker || setor || q.trim().length > 3)
    return { intencao: "noticias", consulta: pergunta, ticker };
  return { intencao: "ajuda" };
}

const refs = (r: number[]) => (r.length ? ` [${r.join("][")}]` : "");
const pctBr = (x: number | null | undefined) =>
  x === null || x === undefined ? "—" : `${x >= 0 ? "+" : "−"}${formatNumber(Math.abs(x), 2)}%`;
const CONF = { alta: "confiança alta", media: "confiança média", baixa: "confiança baixa" };

type NoticiaCitada = { ref: number[]; titulo: string };

export function textoExplicacao(d: {
  ticker: string;
  pregao: string;
  observacao?: string | null;
  retorno_pct: number;
  ibovespa_pct: number | null;
  retorno_anormal_pct: number | null;
  hipoteses: Hipotese[];
  noticias_da_empresa: NoticiaCitada[];
  noticias_de_mercado: NoticiaCitada[];
}): string {
  const linhas = [
    ...(d.observacao ? [d.observacao, ""] : []),
    `${nomeDoTicker(d.ticker)} (${d.ticker}) variou ${pctBr(d.retorno_pct)} no pregão de ${formatDateBr(d.pregao)}, com o Ibovespa em ${pctBr(d.ibovespa_pct)}; o retorno além do que o mercado explica foi de ${pctBr(d.retorno_anormal_pct)} (explain_move).`,
    "",
    "Hipóteses, da mais para a menos provável:",
    ...d.hipoteses.map((h) => {
      const fonte =
        h.hipotese.startsWith("Notícia") && d.noticias_da_empresa[0]
          ? refs(d.noticias_da_empresa[0].ref)
          : h.hipotese.startsWith("Fato macro") && d.noticias_de_mercado[0]
            ? refs(d.noticias_de_mercado[0].ref)
            : "";
      return `- ${h.hipotese} (${CONF[h.confianca]}): ${h.evidencia}${fonte}`;
    }),
  ];
  if (d.noticias_da_empresa.length > 1) {
    linhas.push("", "Outras notícias da empresa na janela:");
    for (const n of d.noticias_da_empresa.slice(1, 4)) linhas.push(`- ${n.titulo}${refs(n.ref)}`);
  }
  if (!d.hipoteses.length)
    linhas.push("- Não encontrei dados suficientes para explicar o movimento.");
  return linhas.join("\n");
}

export function textoChoque(d: {
  origem: string;
  observacao: string | null;
  ranking: { empresa: string; impacto: number; caminho: string }[];
}): string {
  const origem = d.origem.replace(/^(empresa|setor|acionista):/, "");
  const nome = d.origem.startsWith("setor:")
    ? (universe.setores[origem] ?? origem)
    : d.origem.startsWith("empresa:")
      ? nomeDoTicker(origem)
      : origem;
  return [
    `Empresas mais expostas a um choque em ${nome}${d.observacao ? ` (${d.observacao})` : ""}, por PageRank personalizado no grafo de correlações, notícias em comum, controle e setor (shock_propagation). Mede exposição por conexão, não prevê preço.`,
    "",
    ...d.ranking
      .slice(0, 6)
      .map((r) => `- ${r.empresa} — impacto ${formatNumber(r.impacto, 0)}/100: ${r.caminho}`),
  ].join("\n");
}

export function textoSetor(d: {
  setor: string;
  dias: number;
  desde: string;
  ate: string;
  retornos: { ticker: string; retorno_pct: number }[];
  noticias: NoticiaCitada[];
}): string {
  const media = d.retornos.reduce((s, r) => s + r.retorno_pct, 0) / (d.retornos.length || 1);
  const ord = [...d.retornos].sort((a, b) => b.retorno_pct - a.retorno_pct);
  return [
    `${universe.setores[d.setor]}: média simples de ${pctBr(media)} entre ${formatDateBr(d.desde)} e ${formatDateBr(d.ate)} (${d.retornos.length} ativos, get_history).`,
    ord.length
      ? `Melhor: ${ord[0].ticker} (${pctBr(ord[0].retorno_pct)}); pior: ${ord.at(-1)!.ticker} (${pctBr(ord.at(-1)!.retorno_pct)}).`
      : "",
    "",
    d.noticias.length
      ? "Histórias mais relevantes do setor no período:"
      : "Não encontrei notícias relevantes do setor no período.",
    ...d.noticias.slice(0, 5).map((n) => `- ${n.titulo}${refs(n.ref)}`),
  ].join("\n");
}

export function textoNoticias(
  d: { historias: NoticiaCitada[]; metodo_busca: string },
  consulta: string,
): string {
  if (!d.historias.length)
    return `Não encontrei histórias sobre "${consulta}" nos últimos 21 dias.`;
  return [
    `Histórias mais relevantes sobre "${consulta}" (search_news, busca ${d.metodo_busca}):`,
    "",
    ...d.historias.slice(0, 6).map((n) => `- ${n.titulo}${refs(n.ref)}`),
  ].join("\n");
}

export function textoDocumentos(d: {
  ticker: string;
  documentos: { ref: number; titulo: string; data: string }[];
}): string {
  if (!d.documentos.length)
    return `Não encontrei fatos relevantes ou comunicados de ${nomeDoTicker(d.ticker)} nos últimos 60 dias (o índice da CVM é atualizado semanalmente).`;
  return [
    `Documentos recentes de ${nomeDoTicker(d.ticker)} na CVM (get_filings):`,
    "",
    ...d.documentos.map((x) => `- ${formatDateBr(x.data)}: ${x.titulo} [${x.ref}]`),
  ].join("\n");
}

export function textoMacro(d: {
  selic: { valor: number; dia: string } | null;
  ipca: { mes: string; valor: number; acumulado12m: number | null } | null;
  ptax: { valor: number; dia: string; change: number | null } | null;
  ref?: number[];
}): string {
  const l = [`Indicadores do Banco Central (get_macro, SGS)${refs(d.ref ?? [])}:`, ""];
  if (d.selic) l.push(`- Selic meta: ${formatNumber(d.selic.valor)}% ao ano.`);
  if (d.ipca)
    l.push(
      `- IPCA de ${formatMonthBr(d.ipca.mes)}: ${formatNumber(d.ipca.valor)}% no mês${d.ipca.acumulado12m !== null ? `, ${formatNumber(d.ipca.acumulado12m)}% em 12 meses` : ""}.`,
    );
  if (d.ptax)
    l.push(
      `- Dólar PTAX (venda) em ${formatDateBr(d.ptax.dia)}: R$ ${formatNumber(d.ptax.valor, 4)}${d.ptax.change !== null ? ` (${pctBr(d.ptax.change * 100)} no dia)` : ""}.`,
    );
  if (l.length === 2) l.push("Não encontrei dados macro.");
  return l.join("\n");
}

export const TEXTO_AJUDA =
  "Posso explicar por que um ativo se moveu, buscar notícias e fatos relevantes, mostrar quem é mais exposto a um choque, resumir um setor ou trazer Selic, IPCA e dólar. Experimente uma das sugestões.";
