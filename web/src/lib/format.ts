// Formatação pt-BR. Usa o sinal de menos tipográfico (U+2212) para alinhar com o "+".

const MINUS = "−";

export type Direction = "up" | "down" | "flat";

export function direction(value: number, epsilon = 1e-9): Direction {
  if (value > epsilon) return "up";
  if (value < -epsilon) return "down";
  return "flat";
}

function numberFormat(decimals: number): Intl.NumberFormat {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 0.0231 → "+2,31%"; −0.0104 → "−1,04%"; 0 → "0,00%". Entrada em fração (não em %). */
export function formatPercent(fraction: number, decimals = 2): string {
  const dir = direction(fraction);
  const abs = numberFormat(decimals).format(Math.abs(fraction) * 100);
  if (dir === "up") return `+${abs}%`;
  if (dir === "down") return `${MINUS}${abs}%`;
  return `${numberFormat(decimals).format(0)}%`;
}

/** Texto para leitores de tela: "alta de 2,31%", "queda de 1,04%", "estável". */
export function describePercent(fraction: number, decimals = 2): string {
  const abs = numberFormat(decimals).format(Math.abs(fraction) * 100);
  switch (direction(fraction)) {
    case "up":
      return `alta de ${abs}%`;
    case "down":
      return `queda de ${abs}%`;
    default:
      return "estável";
  }
}

export function formatNumber(value: number, decimals = 2): string {
  const s = numberFormat(decimals).format(Math.abs(value));
  return value < 0 ? `${MINUS}${s}` : s;
}

/** "R$ 52,71" */
export function formatBRL(value: number, decimals = 2): string {
  const s = numberFormat(decimals).format(Math.abs(value));
  return `${value < 0 ? MINUS : ""}R$ ${s}`;
}

/** Volume compacto: 61.743.200 → "61,7 mi"; 1.250.000.000 → "1,25 bi". */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${numberFormat(2).format(value / 1e9)} bi`;
  if (abs >= 1e6) return `${numberFormat(1).format(value / 1e6)} mi`;
  if (abs >= 1e3) return `${numberFormat(1).format(value / 1e3)} mil`;
  return numberFormat(0).format(value);
}

/** "2026-10-30" → "30/10/2026" (sem conversão de fuso: é uma data de pregão). */
export function formatDateBr(dia: string): string {
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09" ou "2026-09-01" → "set/2026" */
export function formatMonthBr(dia: string): string {
  const [y, m] = dia.split("-");
  return `${MESES[Number(m) - 1]}/${y}`;
}

/** "31/10/2026 às 18:05" no fuso de São Paulo. */
export function formatDateTimeBr(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} às ${time}`;
}
