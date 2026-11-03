import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import type { Historia } from "@/lib/data/types";

import { classeSentimento } from "./labels";
import { FILTROS_PADRAO, filtrar } from "./news-feed";
import { ScoreBreakdown, StoryCard } from "./story-card";

const comp = (pontos: number, disponivel = true) => ({
  rotulo: "Fator",
  fator: disponivel ? 0.5 : null,
  peso: 0.1,
  pesoEfetivo: disponivel ? 0.2 : 0,
  pontos,
  disponivel,
});

const historia = (over: Partial<Historia> = {}): Historia => ({
  id: 1,
  titulo: "Magazine Luiza cai quase 60% após eleição",
  resumo: null,
  primeiraEm: "2026-10-26T13:00:00Z",
  ultimaEm: "2026-10-26T20:00:00Z",
  tickers: ["MGLU3"],
  fontes: ["Estadão", "Valor"],
  nFontes: 2,
  tipoEvento: "macro",
  materialidade: "alta",
  sentimento: -0.8,
  score: 72.5,
  componentes: {
    materialidade: { ...comp(20), rotulo: "Materialidade do evento" },
    reacao_mercado: { ...comp(30), rotulo: "Reação do mercado", pregao: "2026-10-26" },
    recencia: { ...comp(22.5), rotulo: "Recência" },
    centralidade_grafo: { ...comp(0, false), rotulo: "Centralidade no grafo" },
  },
  extracao: "regras",
  itens: [
    {
      tipo: "noticia",
      titulo: "Magazine Luiza cai quase 60% após eleição",
      fonte: "Estadão",
      link: "https://exemplo.com/a",
      publicadoEm: "2026-10-26T13:00:00Z",
      sentimento: "negativo",
    },
  ],
  ...over,
});

describe("filtro do feed", () => {
  const hs = [
    historia(),
    historia({ id: 2, tickers: ["VALE3"], tipoEvento: "resultado", sentimento: 0.5, score: 40 }),
    historia({ id: 3, tickers: ["PETR4"], tipoEvento: "regulatório", sentimento: 0, score: 10 }),
  ];
  const setor = { MGLU3: "consumo", VALE3: "mineracao_siderurgia", PETR4: "petroleo_gas" };
  const ids = (f: Partial<typeof FILTROS_PADRAO>) =>
    filtrar(hs, { ...FILTROS_PADRAO, ...f }, setor).map((h) => h.id);

  it("combina setor, tipo, sentimento e relevância mínima", () => {
    expect(ids({})).toEqual([1, 2, 3]);
    expect(ids({ setor: "consumo" })).toEqual([1]);
    expect(ids({ tipo: "resultado" })).toEqual([2]);
    expect(ids({ sentimento: "neutro" })).toEqual([3]);
    expect(ids({ minimo: 35 })).toEqual([1, 2]);
    expect(ids({ setor: "consumo", sentimento: "positivo" })).toEqual([]);
  });

  it("classifica o sentimento médio com limiar de 0,2", () => {
    expect(classeSentimento(0.19)).toBe("neutro");
    expect(classeSentimento(-0.2)).toBe("negativo");
    expect(classeSentimento(null)).toBeNull();
  });
});

describe("StoryCard", () => {
  it("mostra score, fontes e sentimento em texto, sem violações de acessibilidade", async () => {
    const { container } = render(<StoryCard historia={historia()} />);
    expect(screen.getByLabelText("Score 73 de 100")).toBeInTheDocument();
    expect(screen.getByText(/sentimento negativo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MGLU3" })).toHaveAttribute("href", "/ativo/MGLU3");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("decomposição soma o score e marca o fator indisponível", () => {
    render(<ScoreBreakdown historia={historia()} />);
    expect(screen.getByText("fase 5")).toBeInTheDocument();
    expect(screen.getByText("72,5")).toBeInTheDocument();
    expect(screen.getByText(/Extração por regras/)).toBeInTheDocument();
  });
});
