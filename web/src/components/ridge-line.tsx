import { cn } from "@/lib/cn";

/**
 * Linha de cume (decisão C8): o único gráfico decorativo da identidade, 1 px em Fog.
 * Na home, o cume é o fechamento real do Ibovespa no último ano. Sem dados, usa um contorno fixo.
 * É decorativo (aria-hidden); os números estão nos cards.
 */
export function RidgeLine({
  values,
  className,
  height = 96,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const width = 1200;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => {
      const x = i * step;
      const y = height - 4 - ((v - min) / span) * (height - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full", className)}
      style={{ height }}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-fog)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Contorno genérico de montanha, usado só quando não há dados (não é dado de mercado). */
export const PLACEHOLDER_RIDGE = [
  12, 14, 13, 17, 22, 19, 24, 31, 28, 26, 33, 41, 37, 35, 44, 52, 47, 43, 49, 58, 55, 50, 46, 53,
  61, 57, 49, 44, 47, 42, 38, 41, 36, 31, 34, 29, 25, 28, 23, 19, 21, 17, 14, 16, 12,
];
