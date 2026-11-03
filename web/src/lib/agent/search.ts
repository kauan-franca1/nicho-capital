import type { Historia } from "@/lib/data/types";

import { semAcento } from "./entities";

/**
 * Busca de histórias (ferramenta search_news).
 * * Semântica: embedding da pergunta com o MESMO e5-small do pipeline (transformers.js, ONNX q8),
 *   centralizado pelo vetor médio exportado, contra a semente centralizada de cada história.
 * * Lexical: termos sem acento em título, resumo e itens, quando o modelo não está pronto.
 * O modelo carrega em segundo plano na primeira chamada (≈470 MB na 1ª vez, depois em cache).
 */

type Extrator = (
  t: string[],
  o: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let carregando: Promise<Extrator> | null = null;
let pronto: Extrator | null = null;

function iniciarModelo(): Promise<Extrator> {
  carregando ??= import("@huggingface/transformers")
    .then(({ pipeline }) =>
      pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" }),
    )
    .then((p) => {
      pronto = p as unknown as Extrator;
      return pronto;
    })
    .catch((err) => {
      carregando = null;
      throw err;
    });
  return carregando;
}

async function embedQuery(texto: string, esperaMs: number): Promise<number[] | null> {
  try {
    const ex =
      pronto ??
      (await Promise.race([
        iniciarModelo(),
        new Promise<null>((r) => setTimeout(() => r(null), esperaMs)),
      ]));
    if (!ex) return null;
    const out = await ex([`query: ${texto}`], { pooling: "mean", normalize: true });
    return out.tolist()[0];
  } catch {
    return null;
  }
}

function centralizar(v: number[], media: number[]): number[] {
  const c = v.map((x, i) => x - (media[i] ?? 0));
  const n = Math.hypot(...c) || 1;
  return c.map((x) => x / n);
}

const PARADAS = new Set(
  "a o as os de da do das dos e em no na nos nas um uma com por para que se sobre como mais menos ao aos esta este essa esse foi sao ser hoje semana porque qual quais".split(
    " ",
  ),
);

export function termos(texto: string): string[] {
  return semAcento(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !PARADAS.has(t));
}

export function pontuarLexical(h: Historia, ts: string[]): number {
  if (ts.length === 0) return 0;
  const corpo = semAcento([h.titulo, h.resumo ?? "", ...h.itens.map((i) => i.titulo)].join(" "));
  const achados = ts.filter((t) => corpo.includes(t)).length;
  return achados / ts.length;
}

export type ResultadoBusca = { historias: Historia[]; metodo: "semantica" | "lexical" };

export async function buscarHistorias(
  historias: (Historia & { vetor?: number[] | null })[],
  consulta: string,
  opts: {
    ticker?: string | null;
    desde?: string | null;
    media?: number[] | null;
    limite?: number;
    esperaMs?: number;
  } = {},
): Promise<ResultadoBusca> {
  const { ticker, desde, media, limite = 8, esperaMs = 1500 } = opts;
  const base = historias.filter(
    (h) => (!ticker || h.tickers.includes(ticker)) && (!desde || h.ultimaEm >= desde),
  );
  const q = media && base.some((h) => h.vetor) ? await embedQuery(consulta, esperaMs) : null;
  if (q && media) {
    const qc = centralizar(q, media);
    const sim = (h: (typeof base)[number]) =>
      h.vetor ? h.vetor.reduce((s, x, i) => s + x * qc[i], 0) : -1;
    // Similaridade decide; relevância desempata (0,1 de peso).
    const ordem = base
      .map((h) => ({ h, s: sim(h) + 0.001 * h.score }))
      .filter((x) => x.s > 0.15 || ticker)
      .sort((a, b) => b.s - a.s);
    return { historias: ordem.slice(0, limite).map((x) => x.h), metodo: "semantica" };
  }
  const ts = termos(consulta);
  const ordem = base
    .map((h) => ({ h, s: pontuarLexical(h, ts) }))
    .filter((x) => x.s > 0 || (ticker && ts.length === 0))
    .sort((a, b) => b.s - a.s || b.h.score - a.h.score);
  const lista = ordem.length ? ordem : ticker ? base.map((h) => ({ h, s: 0 })) : [];
  return { historias: lista.slice(0, limite).map((x) => x.h), metodo: "lexical" };
}

/** Para testes: força o estado "modelo indisponível". */
export function _resetModelo() {
  carregando = null;
  pronto = null;
}
