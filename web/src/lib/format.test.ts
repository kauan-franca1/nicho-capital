import { describe, expect, it } from "vitest";

import {
  describePercent,
  direction,
  formatDateTimeBr,
  formatNumber,
  formatPercent,
} from "./format";

describe("formatPercent", () => {
  it("usa vírgula decimal, sinal de mais e o menos tipográfico", () => {
    expect(formatPercent(0.0231)).toBe("+2,31%");
    expect(formatPercent(-0.0104)).toBe("−1,04%");
    expect(formatPercent(0)).toBe("0,00%");
  });

  it("trata ruído numérico como estável", () => {
    expect(direction(1e-12)).toBe("flat");
    expect(formatPercent(-1e-12)).toBe("0,00%");
  });
});

describe("describePercent", () => {
  it("descreve a direção em palavras para leitores de tela", () => {
    expect(describePercent(0.0231)).toBe("alta de 2,31%");
    expect(describePercent(-0.0104)).toBe("queda de 1,04%");
    expect(describePercent(0)).toBe("estável");
  });
});

describe("formatNumber", () => {
  it("separa milhar com ponto", () => {
    expect(formatNumber(131234.5)).toBe("131.234,50");
    expect(formatNumber(-2.5, 1)).toBe("−2,5");
  });
});

describe("formatDateTimeBr", () => {
  it("converte UTC para o horário de São Paulo", () => {
    expect(formatDateTimeBr("2026-10-30T21:05:00Z")).toBe("30/10/2026 às 18:05");
  });
});
