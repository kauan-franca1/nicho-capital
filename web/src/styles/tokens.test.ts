import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..", "..");
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("tokens (ADR 0004)", () => {
  const tokens = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");

  it("contém todas as cores da identidade visual", () => {
    const identidade = readFileSync(join(ROOT, "docs", "identidade-visual.md"), "utf8");
    const bloco = identidade.slice(identidade.indexOf("### CSS Custom Properties"));
    const cores = [...bloco.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6})/g)];
    expect(cores.length).toBeGreaterThanOrEqual(13);
    for (const [, nome, valor] of cores) {
      expect(tokens, nome).toContain(`${nome}: ${valor};`);
    }
  });

  it("nenhum outro .css define cores literais", () => {
    const culpados = walk(SRC)
      .filter((f) => f.endsWith(".css") && !f.endsWith("tokens.css"))
      .filter((f) => COLOR.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(culpados).toEqual([]);
  });

  it("não exporta a sombra com coral escondido (C11)", () => {
    expect(tokens).not.toMatch(/232,\s*110,\s*88/);
  });
});
