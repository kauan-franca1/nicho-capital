import { cn } from "@/lib/cn";
import { describePercent, direction, formatPercent } from "@/lib/format";

const GLYPH = { up: "▲", down: "▼", flat: "●" } as const;
const TONE = { up: "text-up", down: "text-down", flat: "text-flat" } as const;

type DeltaProps = {
  /** Variação em fração: 0.0231 = +2,31%. */
  value: number;
  decimals?: number;
  className?: string;
};

/**
 * Variação de preço (decisão C1): o significado vem do sinal, da seta e do texto acessível.
 * A cor é só reforço, e some no modo monocromático.
 */
export function Delta({ value, decimals = 2, className }: DeltaProps) {
  const dir = direction(value);
  return (
    <span
      data-numeric
      data-direction={dir}
      className={cn(
        "inline-flex items-baseline gap-4 font-medium tabular-nums",
        dir !== "flat" && "font-semibold",
        TONE[dir],
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.75em]">
        {GLYPH[dir]}
      </span>
      <span aria-hidden="true">{formatPercent(value, decimals)}</span>
      <span className="sr-only">{describePercent(value, decimals)}</span>
    </span>
  );
}
