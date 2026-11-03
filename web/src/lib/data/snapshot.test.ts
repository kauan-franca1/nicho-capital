import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { arquivoTicker, demoDir, SnapshotSource } from "./snapshot";

// O snapshot real versionado em demo/ (gerado pelo pipeline) é o contrato entre Python e TS.
const real = new SnapshotSource(path.resolve(__dirname, "..", "..", "..", "..", "demo"));

describe("SnapshotSource com o snapshot versionado", () => {
  it("lê meta, preços, intraday e macro no formato do pipeline", async () => {
    const meta = await real.meta();
    expect(meta.kind).toBe("snapshot");
    expect(meta.ultimoPregao).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const petr = await real.daily("PETR4");
    expect(petr.length).toBeGreaterThan(500);
    expect(petr.at(-1)?.dia).toBe(meta.ultimoPregao);
    expect(petr.every((b) => b.close > 0)).toBe(true);

    const ibov = await real.daily("^BVSP");
    expect(ibov.length).toBeGreaterThan(500);

    const recent = await real.recentDaily(2);
    expect(Object.keys(recent)).toContain("^BVSP");
    expect(recent.PETR4).toHaveLength(2);

    const macro = await real.macro();
    expect(macro.map((s) => s.slug).sort()).toEqual([
      "ipca_mensal",
      "ptax_venda",
      "selic_diaria",
      "selic_meta",
    ]);
  });
});

describe("SnapshotSource: estatística", () => {
  it("lê anomalias recentes, GARCH, volatilidade e event studies", async () => {
    const recentes = await real.recentAnomalies();
    expect(recentes.length).toBeGreaterThan(0);
    const dias = recentes.map((a) => a.dia);
    expect([...dias].sort().reverse()).toEqual(dias);

    const s = await real.assetStats("MGLU3");
    expect(s.garch?.persistencia).toBeGreaterThan(0);
    expect(s.garch?.persistencia).toBeLessThan(1);
    expect(s.volatilidade.length).toBeGreaterThan(500);
    const es = s.eventStudies.find((e) => e.janela === "[-1,+1]");
    expect(es?.dias.map((d) => d.rel)).toEqual([-1, 0, 1]);
    expect(es && es.icInf <= es.car && es.car <= es.icSup).toBe(true);
  });

  it("ativo sem arquivo de estatística devolve vazio", async () => {
    expect(await real.assetStats("XXXX3")).toEqual({
      anomalias: [],
      garch: null,
      volatilidade: [],
      eventStudies: [],
    });
  });
});

describe("SnapshotSource: notícias", () => {
  it("lê histórias pontuadas, ordenadas por score, com decomposição e itens", async () => {
    const hs = await real.historias();
    expect(hs.length).toBeGreaterThan(10);
    const scores = hs.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const h of hs.slice(0, 20)) {
      expect(h.itens.length).toBeGreaterThan(0);
      const soma = Object.values(h.componentes).reduce((s, c) => s + c.pontos, 0);
      expect(soma).toBeCloseTo(h.score, 0);
    }
    const nlp = await real.nlpInfo();
    expect(nlp.extracoes.length).toBeGreaterThan(0);
  });
});

describe("SnapshotSource: grafos", () => {
  it("lê snapshots de correlação, conhecimento e choque", async () => {
    const g = await real.grafos();
    expect(g.correlacao.length).toBeGreaterThan(12);
    const s = g.correlacao.at(-1)!;
    expect(s.arestas).toHaveLength(s.nos.length - 1); // árvore
    expect(g.conhecimento?.nos.some((n) => n.tipo === "Pessoa")).toBe(true);
    expect(g.choque?.rankings["empresa:VALE3"]?.[0].impacto).toBe(100);
  });
});

describe("SnapshotSource sem snapshot", () => {
  it("devolve vazio em vez de quebrar", async () => {
    const vazio = new SnapshotSource(mkdtempSync(path.join(tmpdir(), "nicho-")));
    expect(await vazio.meta()).toMatchObject({ lastUpdated: null, ultimoPregao: null });
    expect(await vazio.daily("PETR4")).toEqual([]);
    expect(await vazio.recentDaily(2)).toEqual({});
    expect(await vazio.macro()).toEqual([]);
  });
});

describe("helpers", () => {
  it("nome do arquivo do índice e diretório padrão", () => {
    expect(arquivoTicker("^BVSP")).toBe("BVSP.json");
    expect(demoDir()).toMatch(/demo$/);
  });
});
