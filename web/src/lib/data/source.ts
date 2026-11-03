import { cacheLife } from "next/cache";

import { isDemoMode } from "@/lib/env";

import { PostgresSource } from "./postgres";
import { SnapshotSource } from "./snapshot";
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

export type * from "./types";

/**
 * Ponto único de leitura de dados do web (ADR 0002).
 * DEMO_MODE=true (padrão) → snapshot em demo/. Caso contrário, Postgres; se o banco falhar,
 * cai para o snapshot e a interface avisa (meta.fallback).
 *
 * As funções usam `use cache`: os dados mudam duas vezes por dia (cron da fase 7).
 */

function primary(): DataSource {
  return isDemoMode() || !process.env.DATABASE_URL ? new SnapshotSource() : new PostgresSource();
}

async function withFallback<T>(fn: (s: DataSource) => Promise<T>): Promise<T> {
  const src = primary();
  if (src instanceof SnapshotSource) return fn(src);
  try {
    return await fn(src);
  } catch (err) {
    // ECONNREFUSED chega como AggregateError, com `message` vazia: o `code` é o que informa.
    const e = err as Error & { code?: string };
    console.error("[dados] Postgres indisponível, usando snapshot:", e.code ?? e.message);
    return fn(new SnapshotSource(undefined, true));
  }
}

export async function getMeta(): Promise<DataMeta> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.meta());
}

export async function getRecentDaily(n: number): Promise<Record<string, DailyBar[]>> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.recentDaily(n));
}

export async function getDaily(ticker: string): Promise<DailyBar[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.daily(ticker));
}

export async function getIntraday(ticker: string): Promise<IntradayPoint[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.intraday(ticker));
}

export async function getMacro(): Promise<MacroSerie[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.macro());
}

export async function getRecentAnomalies(): Promise<Anomalia[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.recentAnomalies());
}

export async function getAssetStats(ticker: string): Promise<AssetStatsData> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.assetStats(ticker));
}

export async function getHistorias(): Promise<Historia[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.historias());
}

export async function getNlpInfo(): Promise<NlpInfo> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.nlpInfo());
}

export async function getGrafos(): Promise<Grafos> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.grafos());
}

export async function getBriefings(): Promise<Briefing[]> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.briefings());
}

/** Sem cache: /status mostra o estado atual do pipeline. */
export async function getExecucoes(): Promise<Execucao[]> {
  return withFallback((s) => s.execucoes());
}

export async function getVetores(): Promise<VetoresHistorias> {
  "use cache";
  cacheLife("hours");
  return withFallback((s) => s.vetores());
}
