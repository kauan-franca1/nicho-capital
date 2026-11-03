import { cn } from "@/lib/cn";

/**
 * Minigráfico em SVG renderizado no servidor (sem JS no cliente).
 * Uma linha de 1,5 px em Bone e a referência do fechamento anterior tracejada em Smoke.
 */
export function Sparkline({
  values,
  reference,
  label,
  className,
  height = 56,
}: {
  values: number[];
  /** Valor de referência (ex.: fechamento anterior), desenhado como linha tracejada. */
  reference?: number;
  /** Descrição acessível do que o gráfico mostra. */
  label: string;
  className?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const width = 300;
  const all = reference === undefined ? values : [...values, reference];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const y = (v: number) => (height - 2 - ((v - min) / span) * (height - 4)).toFixed(1);
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v)}`)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full", className)}
      style={{ height }}
    >
      {reference !== undefined ? (
        <line
          x1={0}
          x2={width}
          y1={y(reference)}
          y2={y(reference)}
          stroke="var(--border-subtle)"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke="var(--text-primary)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
