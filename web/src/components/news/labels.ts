import type { Historia } from "@/lib/data/types";

export const TIPO_EVENTO: Record<string, string> = {
  resultado: "Resultado",
  dividendos: "Dividendos",
  "M&A": "M&A",
  guidance: "Guidance",
  regulatório: "Regulatório",
  rating: "Rating",
  troca_de_gestao: "Troca de gestão",
  emissao: "Emissão",
  recompra: "Recompra",
  judicial: "Judicial",
  macro: "Macro",
  outro: "Outro",
};

export const MATERIALIDADE: Record<NonNullable<Historia["materialidade"]>, string> = {
  alta: "Materialidade alta",
  media: "Materialidade média",
  baixa: "Materialidade baixa",
};

export type ClasseSentimento = "positivo" | "neutro" | "negativo";

/** Limiar para chamar o sentimento médio de positivo/negativo (escala −1 a +1). */
export const LIMIAR_SENTIMENTO = 0.2;

export function classeSentimento(s: number | null): ClasseSentimento | null {
  if (s === null) return null;
  if (s >= LIMIAR_SENTIMENTO) return "positivo";
  if (s <= -LIMIAR_SENTIMENTO) return "negativo";
  return "neutro";
}

/** C12: sentimento por glifo e texto, nunca por cor. */
export const GLIFO_SENTIMENTO: Record<ClasseSentimento, string> = {
  positivo: "+",
  neutro: "·",
  negativo: "−",
};
