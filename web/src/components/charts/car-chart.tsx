"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EventStudyDia } from "@/lib/data/types";
import { formatDateBr, formatPercent } from "@/lib/format";

/**
 * CAR acumulado por dia relativo ao evento, com a banda do intervalo de confiança (Recharts).
 * Cores só por var(--token) (ADR 0004).
 */
export function CarChart({
  dias,
  nivel,
  label,
  height = 200,
}: {
  dias: EventStudyDia[];
  nivel: number;
  label: string;
  height?: number;
}) {
  const data = dias.map((d) => ({
    rel: d.rel,
    dia: d.dia,
    car: d.car * 100,
    banda: [d.icInf * 100, d.icSup * 100] as [number, number],
  }));
  const tick = { fill: "var(--text-muted)", fontSize: 11 };

  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="rel"
            tick={tick}
            tickFormatter={(v: number) => (v === 0 ? "evento" : v > 0 ? `+${v}` : `${v}`)}
            stroke="var(--border-default)"
          />
          <YAxis
            tick={tick}
            tickFormatter={(v: number) =>
              `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`
            }
            stroke="var(--border-default)"
            width={52}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <ReferenceLine x={0} stroke="var(--border-strong)" strokeDasharray="3 3" />
          <Area
            dataKey="banda"
            stroke="none"
            fill="var(--surface-4)"
            fillOpacity={1}
            isAnimationActive={false}
            name={`IC ${Math.round(nivel * 100)}%`}
          />
          <Line
            dataKey="car"
            stroke="var(--text-primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--text-primary)", stroke: "none" }}
            isAnimationActive={false}
            name="CAR"
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            contentStyle={{
              background: "var(--surface-4)",
              border: "1px solid var(--border-strong)",
              borderRadius: 4,
              color: "var(--text-primary)",
              fontSize: 12,
            }}
            labelFormatter={(_, p) => {
              const d = p?.[0]?.payload as { dia: string; rel: number } | undefined;
              return d ? `Dia ${d.rel} · ${formatDateBr(d.dia)}` : "";
            }}
            formatter={(v, name) =>
              Array.isArray(v)
                ? [
                    `${formatPercent(Number(v[0]) / 100)} a ${formatPercent(Number(v[1]) / 100)}`,
                    name,
                  ]
                : [formatPercent(Number(v) / 100), name]
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
