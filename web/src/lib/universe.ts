import data from "@/generated/universe.json";

export type Ativo = { ticker: string; nome: string; setor: string; apelidos?: string[] };
export type Universe = {
  indice: { ticker: string; nome: string };
  setores: Record<string, string>;
  ativos: Ativo[];
};

export const universe = data as Universe;

export function findAtivo(ticker: string): Ativo | undefined {
  const t = ticker.toUpperCase();
  return universe.ativos.find((a) => a.ticker === t);
}

export function ativosPorSetor(): { setor: string; nome: string; ativos: Ativo[] }[] {
  return Object.entries(universe.setores)
    .map(([setor, nome]) => ({
      setor,
      nome,
      ativos: universe.ativos.filter((a) => a.setor === setor),
    }))
    .filter((g) => g.ativos.length > 0);
}
