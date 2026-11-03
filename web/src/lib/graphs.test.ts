import { describe, expect, it } from "vitest";

import type { Grafos } from "@/lib/data/types";

import { vizinhanca } from "./graphs";

const g: Grafos = {
  correlacao: [
    {
      referencia: "2026-10-30",
      nObs: 63,
      metricas: { rhoMedio: 0.4, nComunidades: 2, comprimentoMst: 3 },
      nos: [
        {
          id: "VALE3",
          setor: "m",
          comunidade: 1,
          x: 0,
          y: 0,
          grau: 1,
          intermediacao: 0,
          autovetor: 0.2,
        },
        {
          id: "KLBN11",
          setor: "p",
          comunidade: 1,
          x: 1,
          y: 0,
          grau: 1,
          intermediacao: 0,
          autovetor: 0.1,
        },
        {
          id: "SUZB3",
          setor: "p",
          comunidade: 1,
          x: 1,
          y: 1,
          grau: 1,
          intermediacao: 0,
          autovetor: 0.1,
        },
        {
          id: "ITUB4",
          setor: "f",
          comunidade: 0,
          x: 2,
          y: 0,
          grau: 1,
          intermediacao: 0,
          autovetor: 0.1,
        },
      ],
      arestas: [
        { source: "KLBN11", target: "VALE3", rho: 0.54, dist: 0.96 },
        { source: "VALE3", target: "SUZB3", rho: 0.41, dist: 1.08 },
        { source: "SUZB3", target: "ITUB4", rho: 0.2, dist: 1.26 },
      ],
    },
  ],
  conhecimento: {
    referencia: "2026-10-31",
    nos: [
      {
        id: "empresa:VALE3",
        tipo: "Empresa",
        rotulo: "Vale",
        x: 0,
        y: 0,
        grau: 3,
        ticker: "VALE3",
      },
      {
        id: "acionista:BLACKROCK",
        tipo: "Acionista",
        rotulo: "BLACKROCK, INC.",
        x: 0,
        y: 0,
        grau: 1,
      },
      { id: "pessoa:X", tipo: "Pessoa", rotulo: "Fulana", x: 0, y: 0, grau: 1 },
      { id: "setor:m", tipo: "Setor", rotulo: "Mineração", x: 0, y: 0, grau: 1 },
    ],
    arestas: [
      {
        source: "pessoa:X",
        target: "empresa:VALE3",
        relacao: "ADMINISTRA",
        peso: 1,
        cargo: "Diretor Presidente",
      },
      {
        source: "acionista:BLACKROCK",
        target: "empresa:VALE3",
        relacao: "PARTICIPA",
        peso: 1,
        percentual: 6.71,
      },
      { source: "empresa:VALE3", target: "setor:m", relacao: "PERTENCE_A", peso: 1 },
    ],
  },
  choque: {
    referencia: "2026-10-31",
    sementes: [{ id: "empresa:VALE3", rotulo: "Vale", tipo: "Empresa" }],
    rankings: {
      "empresa:VALE3": [{ id: "empresa:KLBN11", rotulo: "Klabin", impacto: 100, caminho: [] }],
    },
  },
};

describe("vizinhanca", () => {
  it("junta árvore, comunidade, ligações societárias e choque", () => {
    const v = vizinhanca(g, "VALE3");
    expect(v.mst).toEqual([
      { ticker: "KLBN11", rho: 0.54 },
      { ticker: "SUZB3", rho: 0.41 },
    ]);
    expect(v.comunidade).toEqual(["KLBN11", "SUZB3"]);
    expect(v.ligacoes.map((l) => [l.relacao, l.detalhe])).toEqual([
      ["PARTICIPA", "6,7%"],
      ["ADMINISTRA", "Diretor Presidente"],
    ]); // PERTENCE_A não entra; participação vem antes de administração
    expect(v.choque[0].rotulo).toBe("Klabin");
  });

  it("ativo fora dos grafos não quebra", () => {
    const v = vizinhanca({ correlacao: [], conhecimento: null, choque: null }, "XXXX3");
    expect(v).toEqual({ referencia: null, mst: [], comunidade: [], ligacoes: [], choque: [] });
  });
});
