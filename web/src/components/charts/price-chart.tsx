"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type ISeriesApi,
  type SeriesType,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { DailyBar, IntradayPoint } from "@/lib/data/types";
import { describePercent, formatBRL, formatDateBr } from "@/lib/format";
import { lastSession, type MarcadorEvento } from "@/lib/market";

/**
 * Gráfico de preço (TradingView Lightweight Charts, open source).
 * As cores vêm dos tokens via getComputedStyle: nenhum valor literal (ADR 0004).
 */

const PERIODOS = [
  { id: "1D", label: "1D", pregoes: 0 },
  { id: "1M", label: "1M", pregoes: 21 },
  { id: "6M", label: "6M", pregoes: 126 },
  { id: "1A", label: "1A", pregoes: 252 },
  { id: "3A", label: "3A", pregoes: Infinity },
] as const;
type PeriodoId = (typeof PERIODOS)[number]["id"];

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function PriceChart({
  ticker,
  bars,
  intraday,
  eventos = [],
  height = 360,
}: {
  ticker: string;
  bars: DailyBar[];
  intraday: IntradayPoint[];
  /** Documentos da CVM (quadrado) e notícias de materialidade alta (círculo). */
  eventos?: MarcadorEvento[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [periodo, setPeriodo] = useState<PeriodoId>("6M");
  const [tipo, setTipo] = useState<"linha" | "candles">("linha");

  // O intraday mostra só o último pregão disponível.
  const ultimoDiaIntraday = useMemo(() => lastSession(intraday), [intraday]);

  const periodos = PERIODOS.filter((p) => p.id !== "1D" || ultimoDiaIntraday.length > 1);
  const isIntraday = periodo === "1D" && ultimoDiaIntraday.length > 1;
  const fatia = useMemo(() => {
    const p = PERIODOS.find((x) => x.id === periodo)!;
    return Number.isFinite(p.pregoes) ? bars.slice(-(p.pregoes + 1)) : bars;
  }, [bars, periodo]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const chart: IChartApi = createChart(el, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token("--surface-2") },
        textColor: token("--text-muted"),
        fontFamily: token("--font-family-sans"),
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: token("--border-default") },
      },
      rightPriceScale: { borderColor: token("--border-default") },
      timeScale: {
        borderColor: token("--border-default"),
        timeVisible: isIntraday,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: token("--border-strong"), labelBackgroundColor: token("--surface-4") },
        horzLine: { color: token("--border-strong"), labelBackgroundColor: token("--surface-4") },
      },
      localization: {
        locale: "pt-BR",
        priceFormatter: (p: number) =>
          p.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
    });

    let serie: ISeriesApi<SeriesType> | null = null;
    if (isIntraday) {
      // Lightweight Charts trabalha em UTC: desloca para exibir o horário de Brasília (UTC−3).
      const offset = 3 * 3600;
      const s = chart.addSeries(AreaSeries, areaOpts());
      s.setData(
        ultimoDiaIntraday.map((p) => ({
          time: (Date.parse(p.ts) / 1000 - offset) as Time,
          value: p.close,
        })),
      );
    } else if (tipo === "candles") {
      serie = chart.addSeries(CandlestickSeries, {
        upColor: token("--color-data-up"),
        downColor: token("--color-data-down"),
        borderUpColor: token("--color-data-up"),
        borderDownColor: token("--color-data-down"),
        wickUpColor: token("--color-data-up"),
        wickDownColor: token("--color-data-down"),
      });
      serie.setData(
        fatia
          .filter((b) => b.open !== null && b.high !== null && b.low !== null)
          .map((b) => ({
            time: b.dia as Time,
            open: b.open!,
            high: b.high!,
            low: b.low!,
            close: b.close,
          })),
      );
    } else {
      serie = chart.addSeries(AreaSeries, areaOpts());
      serie.setData(fatia.map((b) => ({ time: b.dia as Time, value: b.close })));
    }
    if (serie) {
      const inicio = fatia[0]?.dia ?? "";
      createSeriesMarkers(
        serie,
        eventos
          .filter((e) => e.dia >= inicio)
          .map((e) => ({
            time: e.dia as Time,
            position: "aboveBar" as const,
            shape: e.tipo === "cvm" ? ("square" as const) : ("circle" as const),
            color: token("--text-primary"),
            size: 1,
          })),
      );
    }
    // O autoSize mede o contêiner depois da criação: reencaixa a série a cada mudança de largura,
    // senão os últimos pregões ficam fora da tela (e fora da escala vertical).
    const ro = new ResizeObserver(() => chart.timeScale().fitContent());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };

    function areaOpts() {
      return {
        lineColor: token("--text-primary"),
        lineWidth: 2 as const,
        topColor: token("--chart-area-top"),
        bottomColor: token("--chart-area-bottom"),
        priceLineColor: token("--border-strong"),
      };
    }
  }, [eventos, fatia, height, isIntraday, tipo, ultimoDiaIntraday]);

  const resumo = useMemo(() => {
    if (isIntraday) {
      const a = ultimoDiaIntraday[0];
      const b = ultimoDiaIntraday.at(-1)!;
      return `Gráfico intradiário de ${ticker} no último pregão, de ${formatBRL(a.close)} a ${formatBRL(b.close)}.`;
    }
    const a = fatia[0];
    const b = fatia.at(-1);
    if (!a || !b) return `Sem dados de preço para ${ticker}.`;
    const n = eventos.filter((e) => e.dia >= a.dia).length;
    const marcados = n ? ` ${n} evento(s) marcado(s) no período.` : "";
    return `Gráfico de preço de ${ticker} de ${formatDateBr(a.dia)} a ${formatDateBr(b.dia)}: de ${formatBRL(a.close)} a ${formatBRL(b.close)}, ${describePercent(b.close / a.close - 1)}.${marcados}`;
  }, [eventos, fatia, isIntraday, ticker, ultimoDiaIntraday]);

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <Segmented
          label="Período"
          options={periodos.map((p) => ({ id: p.id, label: p.label }))}
          value={periodo}
          onChange={(v) => setPeriodo(v as PeriodoId)}
        />
        <Segmented
          label="Tipo de gráfico"
          options={[
            { id: "linha", label: "Linha" },
            { id: "candles", label: "Candles", disabled: isIntraday },
          ]}
          value={isIntraday ? "linha" : tipo}
          onChange={(v) => setTipo(v as "linha" | "candles")}
        />
      </div>
      <div ref={container} role="img" aria-label={resumo} style={{ height }} className="w-full" />
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border border-default p-2"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={o.disabled}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-sm px-10 py-4 text-small font-medium transition-colors duration-(--duration-fast) disabled:opacity-40",
            value === o.id ? "bg-surface-4 text-primary" : "text-muted hover:text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
