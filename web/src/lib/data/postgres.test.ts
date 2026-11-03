import path from "node:path";

import { describe, expect, it } from "vitest";

import { PostgresSource } from "./postgres";
import { SnapshotSource } from "./snapshot";

/**
 * Paridade Postgres × snapshot: o snapshot é exportado do banco, então as duas fontes precisam
 * devolver os mesmos dados. Só roda com DATABASE_URL (ex.: `docker compose up -d db`).
 */
const url = process.env.DATABASE_URL;
const snapshot = new SnapshotSource(path.resolve(__dirname, "..", "..", "..", "..", "demo"));

describe.skipIf(!url)("PostgresSource (paridade com o snapshot)", () => {
  const pg = new PostgresSource();

  it("preços diários e últimos pregões", async () => {
    const [a, b] = await Promise.all([pg.daily("PETR4"), snapshot.daily("PETR4")]);
    expect(a.length).toBe(b.length);
    expect(a.at(-1)).toEqual(b.at(-1));

    const recent = await pg.recentDaily(2);
    expect(recent["^BVSP"]).toEqual((await snapshot.daily("^BVSP")).slice(-2));
  });

  it("macro e meta", async () => {
    const [ma, mb] = await Promise.all([pg.macro(), snapshot.macro()]);
    expect(ma.map((s) => [s.slug, s.observacoes.length])).toEqual(
      mb.map((s) => [s.slug, s.observacoes.length]),
    );
    const meta = await pg.meta();
    expect(meta.kind).toBe("postgres");
    expect(meta.ultimoPregao).toBe((await snapshot.meta()).ultimoPregao);
  });

  it("intraday com o mesmo número de pontos", async () => {
    const [a, b] = await Promise.all([pg.intraday("^BVSP"), snapshot.intraday("^BVSP")]);
    expect(a.length).toBe(b.length);
    expect(a.at(-1)?.close).toBeCloseTo(b.at(-1)!.close, 3);
  });

  it("estatística: mesmas contagens e valores do snapshot", async () => {
    const [a, b] = await Promise.all([pg.assetStats("MGLU3"), snapshot.assetStats("MGLU3")]);
    expect(a.anomalias.length).toBe(b.anomalias.length);
    expect(a.volatilidade.length).toBe(b.volatilidade.length);
    expect(a.eventStudies.length).toBe(b.eventStudies.length);
    expect(a.garch?.persistencia).toBeCloseTo(b.garch!.persistencia, 5);
    expect(a.eventStudies[0].car).toBeCloseTo(b.eventStudies[0].car, 5);
    expect((await pg.recentAnomalies()).length).toBe((await snapshot.recentAnomalies()).length);
  });

  it("notícias: mesmas histórias e scores do snapshot", async () => {
    const [a, b] = await Promise.all([pg.historias(), snapshot.historias()]);
    expect(a.map((h) => h.id)).toEqual(b.map((h) => h.id));
    expect(a[0].score).toBeCloseTo(b[0].score, 1);
    expect(a[0].itens.length).toBe(b[0].itens.length);
    expect(a[0].extracao).toBe(b[0].extracao);
  });

  it("grafos: mesmos snapshots e rankings do snapshot", async () => {
    const [a, b] = await Promise.all([pg.grafos(), snapshot.grafos()]);
    expect(a.correlacao.map((s) => s.referencia)).toEqual(b.correlacao.map((s) => s.referencia));
    expect(a.conhecimento?.nos.length).toBe(b.conhecimento?.nos.length);
    expect(a.choque?.rankings["empresa:VALE3"]).toEqual(b.choque?.rankings["empresa:VALE3"]);
  });
});
