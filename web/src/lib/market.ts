import type { DailyBar, IntradayPoint, MacroSerie } from "@/lib/data/types";
import type { Ativo, Universe } from "@/lib/universe";

/** Preço usado para retornos: ajustado (proventos) quando houver, senão o fechamento. */
const px = (b: DailyBar) => b.adjClose ?? b.close;

const diaSP = (ts: string) =>
  new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Pontos intradiários só do último pregão disponível (o snapshot guarda 5 dias). */
export function lastSession(points: IntradayPoint[]): IntradayPoint[] {
  const ultimo = points.at(-1);
  if (!ultimo) return [];
  const dia = diaSP(ultimo.ts);
  return points.filter((p) => diaSP(p.ts) === dia);
}

export type DailyChange = {
  ticker: string;
  dia: string;
  close: number;
  prevClose: number;
  /** Variação em fração (0.0231 = +2,31%), pelo preço ajustado. */
  change: number;
};

export function dailyChange(ticker: string, bars: DailyBar[]): DailyChange | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const p0 = px(prev);
  if (!(p0 > 0)) return null;
  return {
    ticker,
    dia: last.dia,
    close: last.close,
    prevClose: prev.close,
    change: px(last) / p0 - 1,
  };
}

/**
 * Variações do último pregão. Só entra quem negociou no mesmo dia do índice,
 * para não comparar um ativo parado com o mercado do dia.
 */
export function changesOnDate(
  series: Record<string, DailyBar[]>,
  dia: string | null,
): DailyChange[] {
  return Object.entries(series)
    .map(([t, bars]) => dailyChange(t, bars))
    .filter((c): c is DailyChange => c !== null && (dia === null || c.dia === dia));
}

export function topMovers(changes: DailyChange[], n = 5) {
  const ativos = changes.filter((c) => !c.ticker.startsWith("^"));
  const sorted = [...ativos].sort((a, b) => b.change - a.change);
  return {
    altas: sorted.filter((c) => c.change > 0).slice(0, n),
    baixas: sorted
      .filter((c) => c.change < 0)
      .reverse()
      .slice(0, n),
  };
}

export type SectorPerformance = {
  setor: string;
  nome: string;
  /** Média simples (igual peso) das variações do setor. */
  change: number;
  emAlta: number;
  total: number;
};

export function sectorPerformance(universe: Universe, changes: DailyChange[]): SectorPerformance[] {
  const byTicker = new Map(changes.map((c) => [c.ticker, c]));
  return Object.entries(universe.setores)
    .map(([setor, nome]) => {
      const cs = universe.ativos
        .filter((a: Ativo) => a.setor === setor)
        .map((a) => byTicker.get(a.ticker))
        .filter((c): c is DailyChange => c !== undefined);
      if (cs.length === 0) return null;
      return {
        setor,
        nome,
        change: cs.reduce((s, c) => s + c.change, 0) / cs.length,
        emAlta: cs.filter((c) => c.change > 0).length,
        total: cs.length,
      };
    })
    .filter((s): s is SectorPerformance => s !== null)
    .sort((a, b) => b.change - a.change);
}

// ------------------------------------------------------------------ estatísticas do ativo

export type AssetStats = {
  retorno1m: number | null;
  retorno12m: number | null;
  retornoAno: number | null;
  max52: number | null;
  min52: number | null;
  /** Volatilidade realizada de 21 pregões, anualizada (√252), em fração. */
  vol21: number | null;
  volumeMedio21: number | null;
};

function retornoDesde(bars: DailyBar[], pregoes: number): number | null {
  if (bars.length <= pregoes) return null;
  const a = px(bars[bars.length - 1 - pregoes]);
  return a > 0 ? px(bars[bars.length - 1]) / a - 1 : null;
}

export function assetStats(bars: DailyBar[]): AssetStats {
  const last = bars.at(-1);
  const ano = last?.dia.slice(0, 4);
  // Base do "no ano": último fechamento do ano anterior.
  const baseAno = ano ? [...bars].reverse().find((b) => b.dia.slice(0, 4) < ano) : undefined;
  const janela52 = bars.slice(-252);
  const ultimos = bars.slice(-22);
  const logRets = ultimos.slice(1).map((b, i) => Math.log(px(b) / px(ultimos[i])));
  const media = logRets.reduce((s, r) => s + r, 0) / (logRets.length || 1);
  const variancia =
    logRets.length > 1
      ? logRets.reduce((s, r) => s + (r - media) ** 2, 0) / (logRets.length - 1)
      : null;
  const vols = bars
    .slice(-21)
    .map((b) => b.volume)
    .filter((v): v is number => v !== null);

  return {
    retorno1m: retornoDesde(bars, 21),
    retorno12m: retornoDesde(bars, 252),
    retornoAno: last && baseAno && px(baseAno) > 0 ? px(last) / px(baseAno) - 1 : null,
    max52: janela52.length ? Math.max(...janela52.map((b) => b.high ?? b.close)) : null,
    min52: janela52.length ? Math.min(...janela52.map((b) => b.low ?? b.close)) : null,
    vol21: variancia === null ? null : Math.sqrt(variancia) * Math.sqrt(252),
    volumeMedio21: vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : null,
  };
}

// ------------------------------------------------------------------ macro

export type MacroSummary = {
  selic: { valor: number; dia: string } | null;
  ipca: { mes: string; valor: number; acumulado12m: number | null } | null;
  ptax: { valor: number; dia: string; change: number | null } | null;
};

export function macroSummary(series: MacroSerie[]): MacroSummary {
  const bySlug = new Map(series.map((s) => [s.slug, s.observacoes]));
  const selicObs = bySlug.get("selic_meta") ?? [];
  const ipcaObs = bySlug.get("ipca_mensal") ?? [];
  const ptaxObs = bySlug.get("ptax_venda") ?? [];

  const selic = selicObs.at(-1);
  const ipca = ipcaObs.at(-1);
  const ult12 = ipcaObs.slice(-12);
  const ptax = ptaxObs.at(-1);
  const ptaxPrev = ptaxObs.at(-2);

  return {
    selic: selic ? { valor: selic.valor, dia: selic.dia } : null,
    ipca: ipca
      ? {
          mes: ipca.dia.slice(0, 7),
          valor: ipca.valor,
          // Acumulado em 12 meses: composição das variações mensais (em %).
          acumulado12m:
            ult12.length === 12
              ? (ult12.reduce((p, o) => p * (1 + o.valor / 100), 1) - 1) * 100
              : null,
        }
      : null,
    ptax: ptax
      ? {
          valor: ptax.valor,
          dia: ptax.dia,
          change: ptaxPrev && ptaxPrev.valor > 0 ? ptax.valor / ptaxPrev.valor - 1 : null,
        }
      : null,
  };
}

// ------------------------------------------------------------------ eventos no gráfico

export type MarcadorEvento = {
  /** Pregão (AAAA-MM-DD) em que o evento é marcado. */
  dia: string;
  tipo: "cvm" | "noticia";
  titulo: string;
};

const HORA_FECHAMENTO = 18; // mesma regra do pipeline (nicho/scoring/run.py)

/** Pregão afetado por um evento: depois das 18h de Brasília conta para o pregão seguinte. */
export function pregaoDoEvento(iso: string, dias: string[]): string | null {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  let dia = `${get("year")}-${get("month")}-${get("day")}`;
  if (Number(get("hour")) >= HORA_FECHAMENTO) {
    const prox = new Date(`${dia}T12:00:00Z`);
    prox.setUTCDate(prox.getUTCDate() + 1);
    dia = prox.toISOString().slice(0, 10);
  }
  return dias.find((x) => x >= dia) ?? null;
}

/** Marcadores do ativo: documentos da CVM e notícias de materialidade alta, um por pregão e tipo. */
export function marcadoresDeEventos(
  historias: {
    tickers: string[];
    materialidade: string | null;
    titulo: string;
    primeiraEm: string;
    itens: { tipo: string }[];
  }[],
  ticker: string,
  dias: string[],
): MarcadorEvento[] {
  const vistos = new Set<string>();
  const out: MarcadorEvento[] = [];
  for (const h of historias) {
    if (!h.tickers.includes(ticker)) continue;
    const tipo = h.itens.some((i) => i.tipo === "cvm") ? "cvm" : "noticia";
    if (tipo === "noticia" && h.materialidade !== "alta") continue;
    const dia = pregaoDoEvento(h.primeiraEm, dias);
    if (!dia || vistos.has(`${dia}|${tipo}`)) continue;
    vistos.add(`${dia}|${tipo}`);
    out.push({ dia, tipo, titulo: h.titulo });
  }
  return out.sort((a, b) => a.dia.localeCompare(b.dia));
}
