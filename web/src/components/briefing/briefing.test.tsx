import path from "node:path";

import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { SnapshotSource } from "@/lib/data/snapshot";

import { BriefingView } from "./briefing-view";

const real = new SnapshotSource(path.resolve(__dirname, "..", "..", "..", "..", "demo"));

describe("BriefingView com o snapshot versionado", () => {
  it("toda afirmação com fonte vira link, e a página passa no axe", async () => {
    const [b] = await real.briefings();
    expect(b).toBeDefined();
    expect(b.secoes.map((s) => s.id)).toEqual(["mercado", "macro", "noticias", "cvm", "anomalias"]);
    const { container } = render(<BriefingView b={b} />);
    const citacoes = b.secoes.flatMap((s) => s.itens).flatMap((i) => i.refs).length;
    expect(container.querySelectorAll("article sup a")).toHaveLength(citacoes);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(b.fontes.length);
    // Fonte externa abre em nova aba; interna (/ativo/...) navega no app.
    const externo = container.querySelector('a[href^="https://"]');
    expect(externo).toHaveAttribute("rel", "noopener noreferrer");
    const interno = container.querySelector('a[href^="/ativo/"]');
    expect(interno).not.toHaveAttribute("target");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("execuções do pipeline vêm no snapshot", async () => {
    const runs = await real.execucoes();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((r) => r.etapa === "briefing" && r.status === "ok")).toBe(true);
  });
});
