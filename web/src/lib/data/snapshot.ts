import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  toAnomalia,
  toBriefing,
  toEventStudy,
  toExecucao,
  toGarch,
  toHistoria,
  toNlpInfo,
  toGrafos,
} from "./mappers";
import type {
  Anomalia,
  AssetStatsData,
  Briefing,
  Execucao,
  DailyBar,
  DataMeta,
  DataSource,
  Grafos,
  Historia,
  IntradayPoint,
  MacroSerie,
  NlpInfo,
  VetoresHistorias,
} from "./types";

/**
 * Lê o snapshot JSON gerado por `nicho export-demo` (formato em pipeline/nicho/export.py).
 * Funciona sem banco, sem internet e sem chaves (ADR 0002).
 */

type Linha = [
  string,
  number | null,
  number | null,
  number | null,
  number,
  number | null,
  number | null,
  string,
];
type PrecosFile = { ticker: string; colunas: string[]; linhas: Linha[] };
type IntradayFile = {
  intervalo: string;
  series: Record<string, [string, number, number | null][]>;
};
type MacroFile = {
  series: (Omit<MacroSerie, "observacoes"> & { observacoes: [string, number][] })[];
};
type MetaFile = { ultima_atualizacao: string | null; ultimo_pregao: string | null };
type AtivoFile = { ticker: string; is_index: boolean };
type Raw = Record<string, unknown>;
type StatsFile = {
  anomalias: Raw[];
  garch: Raw | null;
  volatilidade: [string, number | null, number | null][];
  event_studies: Raw[];
};
type AnomaliasFile = { anomalias: Raw[] };

/** `demo/` fica na raiz do repo: aceita rodar a partir de web/ (padrão) ou da raiz. */
export function demoDir(): string {
  if (process.env.DEMO_DIR) return process.env.DEMO_DIR;
  const candidatos = [
    path.resolve(process.cwd(), "..", "demo"),
    path.resolve(process.cwd(), "demo"),
  ];
  return candidatos.find((d) => existsSync(path.join(d, "meta.json"))) ?? candidatos[0];
}

export function arquivoTicker(ticker: string): string {
  return `${ticker.replace("^", "")}.json`;
}

export function toBar(l: Linha): DailyBar {
  const [dia, open, high, low, close, adjClose, volume] = l;
  return { dia, open, high, low, close, adjClose, volume };
}

export class SnapshotSource implements DataSource {
  constructor(
    private readonly dir: string = demoDir(),
    private readonly fallback = false,
  ) {}

  private async json<T>(rel: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, rel), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async meta(): Promise<DataMeta> {
    const m = await this.json<MetaFile>("meta.json");
    return {
      kind: "snapshot",
      fallback: this.fallback,
      lastUpdated: m?.ultima_atualizacao ?? null,
      ultimoPregao: m?.ultimo_pregao ?? null,
    };
  }

  async daily(ticker: string): Promise<DailyBar[]> {
    const f = await this.json<PrecosFile>(`precos/${arquivoTicker(ticker)}`);
    return f ? f.linhas.map(toBar) : [];
  }

  async recentDaily(n: number): Promise<Record<string, DailyBar[]>> {
    const ativos = (await this.json<AtivoFile[]>("ativos.json")) ?? [];
    const entries = await Promise.all(
      ativos.map(async (a) => [a.ticker, (await this.daily(a.ticker)).slice(-n)] as const),
    );
    return Object.fromEntries(entries);
  }

  async intraday(ticker: string): Promise<IntradayPoint[]> {
    const f = await this.json<IntradayFile>("intraday.json");
    return (f?.series[ticker] ?? []).map(([ts, close, volume]) => ({ ts, close, volume }));
  }

  async macro(): Promise<MacroSerie[]> {
    const f = await this.json<MacroFile>("macro.json");
    return (f?.series ?? []).map((s) => ({
      ...s,
      observacoes: s.observacoes.map(([dia, valor]) => ({ dia, valor })),
    }));
  }

  async recentAnomalies(): Promise<Anomalia[]> {
    const f = await this.json<AnomaliasFile>("anomalias.json");
    return (f?.anomalias ?? []).map(toAnomalia);
  }

  async assetStats(ticker: string): Promise<AssetStatsData> {
    const f = await this.json<StatsFile>(`stats/${arquivoTicker(ticker)}`);
    if (!f) return { anomalias: [], garch: null, volatilidade: [], eventStudies: [] };
    return {
      anomalias: f.anomalias.map((a) => toAnomalia({ ticker, ...a })),
      garch: toGarch(f.garch),
      volatilidade: f.volatilidade.map(([dia, garch, realizada]) => ({ dia, garch, realizada })),
      eventStudies: f.event_studies.map(toEventStudy),
    };
  }

  async historias(): Promise<Historia[]> {
    const f = await this.json<{ historias: Raw[] }>("noticias.json");
    return (f?.historias ?? []).map(toHistoria);
  }

  async nlpInfo(): Promise<NlpInfo> {
    return toNlpInfo(await this.json<Raw>("nlp.json"));
  }

  async grafos(): Promise<Grafos> {
    const [c, k, ch] = await Promise.all([
      this.json<Raw>("grafos/correlacao.json"),
      this.json<Raw>("grafos/conhecimento.json"),
      this.json<Raw>("grafos/choque.json"),
    ]);
    return toGrafos(c, k, ch);
  }

  async vetores(): Promise<VetoresHistorias> {
    const [n, nlp] = await Promise.all([
      this.json<{ historias: { id: number; vetor?: number[] | null }[] }>("noticias.json"),
      this.json<{ embedding_media?: number[] | null }>("nlp.json"),
    ]);
    const porHistoria: Record<number, number[]> = {};
    for (const h of n?.historias ?? []) if (h.vetor) porHistoria[h.id] = h.vetor;
    return { media: nlp?.embedding_media ?? null, porHistoria };
  }

  async briefings(): Promise<Briefing[]> {
    const f = await this.json<{ briefings: Parameters<typeof toBriefing>[0][] }>("briefing.json");
    return (f?.briefings ?? []).map(toBriefing);
  }

  async execucoes(): Promise<Execucao[]> {
    const f = await this.json<{ execucoes: Parameters<typeof toExecucao>[0][] }>("status.json");
    return (f?.execucoes ?? []).map(toExecucao);
  }
}
