import { describe, expect, it } from "vitest";

import { carregarMetodologia, extrairFormulas, renderizar } from "./methodology";

describe("metodologia", () => {
  it("fórmulas viram KaTeX sem passar pelo markdown", () => {
    const { texto, formulas } = extrairFormulas("Seja $x_t * 2$ e $$\\sum_i a_i$$. Custa R$ 0.");
    // Blocos ($$) são extraídos primeiro, para o $ simples não casar dentro deles.
    expect(texto).toBe("Seja KATEX1FIM e KATEX0FIM. Custa R$ 0.");
    expect(formulas[0]).toContain("katex-display");
    expect(formulas[1]).toContain('class="katex"');
  });

  it("rebaixa títulos, gera âncoras e neutraliza links relativos", () => {
    const d = renderizar(
      "# Doc\n\n## Seção Única\n\nVer [ADR](ADRs/0001.md) e [site](https://x.test).",
      "doc",
    );
    expect(d.titulo).toBe("Doc");
    expect(d.html).toContain('<h3 id="doc-secao-unica">Seção Única</h3>');
    expect(d.html).not.toContain("ADRs/0001.md");
    expect(d.html).toContain('rel="noopener noreferrer"');
    expect(d.secoes).toEqual([{ id: "doc-secao-unica", titulo: "Seção Única", nivel: 2 }]);
  });

  it("os docs reais renderizam sem erro de KaTeX", async () => {
    const docs = await carregarMetodologia();
    expect(docs.map((d) => d.id)).toEqual(["estatistica", "noticias", "grafos", "agente"]);
    for (const d of docs) {
      expect(d.html).not.toContain("katex-error");
      expect(d.html).not.toMatch(/KATEX\d+FIM/);
      expect(d.secoes.length).toBeGreaterThan(2);
    }
  });
});
