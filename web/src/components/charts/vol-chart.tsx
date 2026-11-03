"use client";

import { ColorType, createChart, LineSeries, LineStyle, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";

import type { VolPoint } from "@/lib/data/types";

const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Volatilidade GARCH (linha cheia) × realizada de 21 pregões (tracejada), em % ao ano. */
export function VolChart({
  pontos,
  label,
  height = 240,
}: {
  pontos: VolPoint[];
  label: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token("--surface-2") },
        textColor: token("--text-muted"),
        fontFamily: token("--font-family-sans"),
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: token("--border-default") } },
      rightPriceScale: { borderColor: token("--border-default") },
      // Mantém a série inteira visível quando o layout muda a largura depois da criação.
      timeScale: { borderColor: token("--border-default") },
      localization: {
        locale: "pt-BR",
        priceFormatter: (p: number) =>
          `${p.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`,
      },
    });
    const garch = chart.addSeries(LineSeries, {
      color: token("--text-primary"),
      lineWidth: 2,
      priceLineVisible: false,
      title: "GARCH",
    });
    const real = chart.addSeries(LineSeries, {
      color: token("--text-muted"),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      title: "Realizada 21d",
    });
    garch.setData(
      pontos
        .filter((p) => p.garch !== null)
        .map((p) => ({ time: p.dia as Time, value: p.garch! * 100 })),
    );
    real.setData(
      pontos
        .filter((p) => p.realizada !== null)
        .map((p) => ({ time: p.dia as Time, value: p.realizada! * 100 })),
    );
    // O autoSize mede o contêiner depois da criação: reencaixa a série a cada mudança de largura,
    // senão os últimos pregões ficam fora da tela (e fora da escala vertical).
    const ro = new ResizeObserver(() => chart.timeScale().fitContent());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [pontos, height]);

  return <div ref={ref} role="img" aria-label={label} style={{ height }} className="w-full" />;
}
