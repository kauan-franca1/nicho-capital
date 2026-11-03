import type { Grafos, ImpactoChoque } from "@/lib/data/types";

export type Vizinhanca = {
  referencia: string | null;
  mst: { ticker: string; rho: number }[];
  comunidade: string[];
  ligacoes: { rotulo: string; tipo: string; relacao: string; detalhe: string | null }[];
  choque: ImpactoChoque[];
};

const REL_PRIORIDADE: Record<string, number> = {
  CONTROLA: 0,
  PARTICIPA: 1,
  ADMINISTRA: 2,
  CO_MENCIONADA_COM: 3,
};

/** Tudo o que os grafos dizem sobre um ativo, para o card "Vizinhos no grafo". */
export function vizinhanca(g: Grafos, ticker: string): Vizinhanca {
  const s = g.correlacao.at(-1);
  const mst = (s?.arestas ?? [])
    .filter((e) => e.source === ticker || e.target === ticker)
    .map((e) => ({ ticker: e.source === ticker ? e.target : e.source, rho: e.rho }))
    .sort((a, b) => b.rho - a.rho);
  const minha = s?.nos.find((n) => n.id === ticker)?.comunidade;
  const comunidade =
    minha === undefined
      ? []
      : (s?.nos ?? [])
          .filter((n) => n.comunidade === minha && n.id !== ticker)
          .map((n) => n.id)
          .sort();

  const id = `empresa:${ticker}`;
  const nos = new Map((g.conhecimento?.nos ?? []).map((n) => [n.id, n]));
  const ligacoes = (g.conhecimento?.arestas ?? [])
    .filter((e) => (e.source === id || e.target === id) && e.relacao in REL_PRIORIDADE)
    .map((e) => {
      const outro = nos.get(e.source === id ? e.target : e.source);
      const detalhe =
        e.relacao === "ADMINISTRA"
          ? (e.cargo ?? null)
          : e.percentual
            ? `${e.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
            : null;
      return {
        rotulo: outro?.rotulo ?? "?",
        tipo: outro?.tipo ?? "?",
        relacao: e.relacao,
        detalhe,
      };
    })
    .sort(
      (a, b) =>
        REL_PRIORIDADE[a.relacao] - REL_PRIORIDADE[b.relacao] || a.rotulo.localeCompare(b.rotulo),
    );

  return {
    referencia: s?.referencia ?? null,
    mst,
    comunidade,
    ligacoes,
    choque: (g.choque?.rankings[id] ?? []).slice(0, 5),
  };
}
