import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { Delta } from "./delta";
import { SiteHeader } from "./layout/site-header";
import { StaleDataStamp } from "./stale-data-stamp";
import { Badge } from "./ui/badge";

vi.mock("next/navigation", () => ({ usePathname: () => "/ativo/PETR4" }));

async function violations(container: HTMLElement) {
  // color-contrast precisa de layout real; os contrastes estão validados em decisoes-de-design.md.
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

describe("Delta (decisão C1)", () => {
  it("não depende só de cor: tem seta, sinal e rótulo acessível", () => {
    const { container } = render(<Delta value={0.0231} />);
    const el = screen.getByText("alta de 2,31%");
    expect(el).toHaveClass("sr-only");
    expect(el.parentElement).toHaveAttribute("data-direction", "up");
    expect(container.textContent).toContain("▲");
    expect(container.textContent).toContain("+2,31%");
  });

  it("queda usa seta para baixo e menos tipográfico", () => {
    const { container } = render(<Delta value={-0.0104} />);
    expect(screen.getByText("queda de 1,04%").parentElement).toHaveAttribute(
      "data-direction",
      "down",
    );
    expect(container.textContent).toContain("▼−1,04%");
  });

  it("sem violações de acessibilidade", async () => {
    const { container } = render(
      <p>
        PETR4 <Delta value={0.0231} /> VALE3 <Delta value={-0.01} />
      </p>,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe("StaleDataStamp", () => {
  it("sempre avisa que os dados têm atraso", () => {
    render(<StaleDataStamp lastUpdated={null} />);
    expect(screen.getByText(/não é tempo real/)).toBeInTheDocument();
  });

  it("mostra o horário de São Paulo da última atualização", () => {
    render(<StaleDataStamp lastUpdated="2026-10-30T21:05:00Z" />);
    expect(screen.getByText("30/10/2026 às 18:05")).toHaveAttribute(
      "datetime",
      "2026-10-30T21:05:00Z",
    );
  });
});

describe("SiteHeader", () => {
  it("marca Mercado como página atual dentro de /ativo", async () => {
    const { container } = render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Mercado" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});

describe("Badge (decisão C12)", () => {
  it("status forte muda borda e peso, não a cor", () => {
    render(<Badge variant="strong">Falhou</Badge>);
    const cls = screen.getByText("Falhou").className;
    expect(cls).toContain("border-2");
    expect(cls).toContain("font-semibold");
    expect(cls).not.toMatch(/\b(text|bg|border)-(up|down|red|green)/);
  });
});
