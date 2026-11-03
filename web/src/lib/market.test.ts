import { describe, expect, it } from "vitest";

import type { DailyBar, MacroSerie } from "@/lib/data/types";

import {
  assetStats,
  changesOnDate,
  dailyChange,
  lastSession,
  marcadoresDeEventos,
  pregaoDoEvento,
  macroSummary,
  sectorPerformance,
  topMovers,
} from "./market";

const bar = (dia: string, close: number, extra: Partial<DailyBar> = {}): DailyBar => ({
  dia,
  open: null,
  high: null,
  low: null,
  close,
  adjClose: null,
  volume: 100,
  ...extra,
});

describe("lastSession", () => {
  it("mantém só o último pregão no fuso de São Paulo", () => {
    const pts = [
      { ts: "2026-10-29T19:45:00+00:00", close: 1, volume: null },
      { ts: "2026-10-30T02:30:00+00:00", close: 2, volume: null }, // 23:30 de 29/10 em SP
      { ts: "2026-10-30T13:00:00+00:00", close: 3, volume: null },
      { ts: "2026-10-30T19:45:00+00:00", close: 4, volume: null },
    ];
    expect(lastSession(pts).map((p) => p.close)).toEqual([3, 4]);
    expect(lastSession([])).toEqual([]);
  });
});

describe("dailyChange", () => {
  it("usa o preço ajustado quando existe", () => {
    const c = dailyChange("X", [
      bar("2026-10-29", 10, { adjClose: 8 }),
      bar("2026-10-30", 10.5, { adjClose: 8.4 }),
    ]);
    expect(c?.change).toBeCloseTo(0.05);
    expect(c?.close).toBe(10.5);
  });

  it("precisa de dois pregões", () => {
    expect(dailyChange("X", [bar("2026-10-30", 10)])).toBeNull();
  });
});

describe("changesOnDate e topMovers", () => {
  const series = {
    "^BVSP": [bar("2026-10-29", 100), bar("2026-10-30", 101)],
    AAAA3: [bar("2026-10-29", 10), bar("2026-10-30", 11)],
    BBBB3: [bar("2026-10-29", 10), bar("2026-10-30", 9)],
    CCCC3: [bar("2026-10-29", 10), bar("2026-10-30", 10.2)],
    PARA3: [bar("2026-10-28", 10), bar("2026-10-29", 20)], // não negociou no último pregão
  };

  it("ignora quem não negociou no pregão do índice", () => {
    const cs = changesOnDate(series, "2026-10-30");
    expect(cs.map((c) => c.ticker).sort()).toEqual(["AAAA3", "BBBB3", "CCCC3", "^BVSP"]);
  });

  it("separa altas e baixas, sem o índice", () => {
    const { altas, baixas } = topMovers(changesOnDate(series, "2026-10-30"));
    expect(altas.map((c) => c.ticker)).toEqual(["AAAA3", "CCCC3"]);
    expect(baixas.map((c) => c.ticker)).toEqual(["BBBB3"]);
  });
});

describe("sectorPerformance", () => {
  it("faz média simples por setor e conta quantos subiram", () => {
    const universe = {
      indice: { ticker: "^BVSP", nome: "Ibovespa" },
      setores: { a: "Setor A", b: "Setor B", vazio: "Sem dados" },
      ativos: [
        { ticker: "AAAA3", nome: "A", setor: "a" },
        { ticker: "BBBB3", nome: "B", setor: "a" },
        { ticker: "CCCC3", nome: "C", setor: "b" },
      ],
    };
    const cs = [
      { ticker: "AAAA3", dia: "d", close: 1, prevClose: 1, change: 0.04 },
      { ticker: "BBBB3", dia: "d", close: 1, prevClose: 1, change: -0.02 },
      { ticker: "CCCC3", dia: "d", close: 1, prevClose: 1, change: 0.03 },
    ];
    const s = sectorPerformance(universe, cs);
    expect(s.map((x) => x.setor)).toEqual(["b", "a"]);
    expect(s[1].change).toBeCloseTo(0.01);
    expect(s[1]).toMatchObject({ emAlta: 1, total: 2 });
  });
});

describe("assetStats", () => {
  it("calcula retornos e volatilidade de uma série com crescimento constante", () => {
    // 300 pregões subindo 0,1% ao dia: volatilidade zero, retorno de 21 pregões = 1,001^21 − 1.
    const bars = Array.from({ length: 300 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      return bar(d, 100 * 1.001 ** i, {
        high: 100 * 1.001 ** i * 1.01,
        low: 100 * 1.001 ** i * 0.99,
      });
    });
    const s = assetStats(bars);
    expect(s.retorno1m).toBeCloseTo(1.001 ** 21 - 1, 10);
    expect(s.retorno12m).toBeCloseTo(1.001 ** 252 - 1, 10);
    expect(s.vol21).toBeCloseTo(0, 10);
    expect(s.max52).toBeCloseTo(bars[299].close * 1.01, 8);
    expect(s.min52).toBeCloseTo(bars[48].close * 0.99, 8);
    expect(s.volumeMedio21).toBe(100);
    // último pregão em 2025-10-27; base do ano = 31/12/2024 não existe → primeiro ano sem base
    expect(s.retornoAno).toBeNull();
  });

  it("volatilidade anualizada com √252", () => {
    // alterna +1% e −1% em log: desvio-padrão amostral conhecido
    const closes = [100];
    for (let i = 0; i < 21; i++) closes.push(closes[i] * Math.exp(i % 2 === 0 ? 0.01 : -0.01));
    const bars = closes.map((c, i) => bar(`2026-01-${String(i + 1).padStart(2, "0")}`, c));
    const r = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
    expect(assetStats(bars).vol21).toBeCloseTo(sd * Math.sqrt(252), 10);
  });

  it("retorno no ano usa o último fechamento do ano anterior", () => {
    const bars = [
      bar("2025-12-30", 90),
      bar("2025-12-31", 100),
      bar("2026-01-02", 101),
      bar("2026-10-30", 110),
    ];
    expect(assetStats(bars).retornoAno).toBeCloseTo(0.1);
  });
});

describe("macroSummary", () => {
  const serie = (slug: string, obs: [string, number][]): MacroSerie => ({
    codigo: 0,
    slug,
    nome: slug,
    unidade: "",
    periodicidade: "mensal",
    observacoes: obs.map(([dia, valor]) => ({ dia, valor })),
  });

  it("compõe o IPCA de 12 meses e calcula a variação da PTAX", () => {
    const ipca = Array.from(
      { length: 12 },
      (_, i) => [`2026-${String(i + 1).padStart(2, "0")}-01`, 0.5] as [string, number],
    );
    const s = macroSummary([
      serie("ipca_mensal", ipca),
      serie("ptax_venda", [
        ["2026-10-29", 5.0],
        ["2026-10-30", 5.1],
      ]),
      serie("selic_meta", [["2026-10-31", 13.75]]),
    ]);
    expect(s.ipca?.acumulado12m).toBeCloseTo((1.005 ** 12 - 1) * 100, 10);
    expect(s.ipca?.mes).toBe("2026-12");
    expect(s.ptax?.change).toBeCloseTo(0.02);
    expect(s.selic).toEqual({ valor: 13.75, dia: "2026-10-31" });
  });

  it("sem 12 meses não inventa acumulado", () => {
    expect(
      macroSummary([serie("ipca_mensal", [["2026-09-01", 0.82]])]).ipca?.acumulado12m,
    ).toBeNull();
  });
});

describe("eventos no gráfico", () => {
  const dias = ["2026-10-23", "2026-10-26", "2026-10-27"];

  it("depois das 18h de Brasília o evento vai para o pregão seguinte", () => {
    expect(pregaoDoEvento("2026-10-23T15:00:00Z", dias)).toBe("2026-10-23"); // 12h em SP
    expect(pregaoDoEvento("2026-10-23T22:00:00Z", dias)).toBe("2026-10-26"); // 19h, sexta → segunda
    expect(pregaoDoEvento("2026-10-25T13:00:00Z", dias)).toBe("2026-10-26"); // domingo
    expect(pregaoDoEvento("2026-10-30T13:00:00Z", dias)).toBeNull();
  });

  it("marca documentos da CVM e só notícias de materialidade alta, sem repetir", () => {
    const h = (titulo: string, materialidade: string | null, tipo: string, quando: string) => ({
      tickers: ["MGLU3"],
      materialidade,
      titulo,
      primeiraEm: quando,
      itens: [{ tipo }],
    });
    const m = marcadoresDeEventos(
      [
        h("Fato relevante", null, "cvm", "2026-10-23T15:00:00Z"),
        h("Queda forte", "alta", "noticia", "2026-10-26T13:00:00Z"),
        h("Outra queda", "alta", "noticia", "2026-10-26T14:00:00Z"),
        h("Rotina", "baixa", "noticia", "2026-10-27T13:00:00Z"),
      ],
      "MGLU3",
      dias,
    );
    expect(m.map((x) => `${x.dia}:${x.tipo}`)).toEqual(["2026-10-23:cvm", "2026-10-26:noticia"]);
    expect(
      marcadoresDeEventos([h("x", "alta", "noticia", "2026-10-26T13:00:00Z")], "VALE3", dias),
    ).toEqual([]);
  });
});
