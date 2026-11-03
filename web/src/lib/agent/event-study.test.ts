import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/data/types";

import { eventStudy, pBicaudal, tCritico } from "./event-study";

/** Gerador determinístico (LCG + Box-Muller) para dados sintéticos reprodutíveis. */
function rng(seed: number) {
  let s = seed;
  const u = () => ((s = (s * 1664525 + 1013904223) % 4294967296) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

function series(efeito: number, seed = 7, n = 400) {
  const g = rng(seed);
  const dias = Array.from({ length: n + 1 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
  );
  let pm = 100;
  let pa = 50;
  const m: DailyBar[] = [];
  const a: DailyBar[] = [];
  dias.forEach((dia, i) => {
    if (i > 0) {
      const rmk = 0.0003 + 0.012 * g();
      let rak = 0.0002 + 1.3 * rmk + 0.008 * g();
      if (i === 300) rak += efeito;
      pm *= Math.exp(rmk);
      pa *= Math.exp(rak);
    }
    const bar = (c: number): DailyBar => ({
      dia,
      open: null,
      high: null,
      low: null,
      close: c,
      adjClose: c,
      volume: 1,
    });
    m.push(bar(pm));
    a.push(bar(pa));
  });
  return { a, m, evento: dias[300] };
}

describe("distribuição t", () => {
  it("valores conhecidos", () => {
    expect(pBicaudal(0, 10)).toBeCloseTo(1, 6);
    expect(pBicaudal(2.228, 10)).toBeCloseTo(0.05, 3); // t crítico tabelado, gl = 10
    expect(tCritico(0.95, 238)).toBeCloseTo(1.97, 2);
  });
});

describe("eventStudy (mesmo cenário do teste em Python)", () => {
  it("recupera efeito sintético de +6%", () => {
    const { a, m, evento } = series(0.06);
    const r = eventStudy(a, m, evento)!;
    expect(r.beta).toBeCloseTo(1.3, 0);
    expect(r.nEstimacao).toBe(240);
    expect(r.car).toBeGreaterThan(0.03);
    expect(r.pValor).toBeLessThan(0.01);
    expect(r.icInf).toBeGreaterThan(0);
    expect(r.dias.map((d) => d.rel)).toEqual([-1, 0, 1]);
  });

  it("sem efeito: não significativo na maioria das sementes", () => {
    let rejeita = 0;
    for (let s = 1; s <= 60; s++) {
      const { a, m, evento } = series(0, 1000 + s);
      if (eventStudy(a, m, evento, [0, 5])!.pValor < 0.05) rejeita++;
    }
    expect(rejeita / 60).toBeLessThan(0.15);
  });

  it("sem histórico ou janela incompleta: null", () => {
    const { a, m } = series(0);
    expect(eventStudy(a, m, a[100].dia)).toBeNull();
    expect(eventStudy(a, m, a.at(-2)!.dia, [0, 5])).toBeNull();
  });
});
