import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { Answer } from "./answer";
import { aplicar, Chat } from "./chat";

const fonte = {
  n: 1,
  titulo: "Magalu cai após resultado",
  link: "https://exemplo.test/n1",
  origem: "Valor",
  data: "2026-10-26T12:00:00Z",
};

async function semViolacoes(container: HTMLElement) {
  const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => v.id)).toEqual([]);
}

describe("Answer", () => {
  it("renderiza parágrafo, lista, negrito e citação como link", async () => {
    const { container } = render(
      <Answer
        texto={"MGLU3 caiu **10%** [1].\n- Hipótese A [1]\n- Hipótese B [9]"}
        fontes={[fonte]}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("10%");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", fonte.link);
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    // Citação sem fonte correspondente não vira link.
    expect(container.textContent).toContain("[9]");
    await semViolacoes(container);
  });

  it("não interpreta HTML vindo do modelo", () => {
    const { container } = render(<Answer texto={'<img src=x onerror="alert(1)">'} fontes={[]} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Chat", () => {
  const vazio = {
    pergunta: "q",
    passos: [],
    texto: "",
    fontes: [],
    modo: null,
    estado: "rodando" as const,
  };

  it("aplica eventos do stream (passo é atualizado pelo id)", () => {
    let t = aplicar(vazio, { tipo: "modo", modo: "regras" });
    t = aplicar(t, {
      tipo: "passo",
      id: 1,
      ferramenta: "get_quote",
      texto: "Cotação",
      status: "rodando",
    });
    t = aplicar(t, {
      tipo: "passo",
      id: 1,
      ferramenta: "get_quote",
      texto: "Cotação",
      status: "ok",
      resumo: "VALE3 +1%",
    });
    t = aplicar(t, { tipo: "texto", delta: "Olá" });
    t = aplicar(t, { tipo: "texto", delta: " mundo" });
    t = aplicar(t, { tipo: "fim" });
    expect(t.passos).toHaveLength(1);
    expect(t.passos[0].status).toBe("ok");
    expect(t.texto).toBe("Olá mundo");
    expect(t.estado).toBe("pronto");
  });

  it("mostra sugestões clicáveis e campo com limite", async () => {
    const { container } = render(<Chat sugestoes={["Por que MGLU3 caiu?"]} />);
    expect(screen.getByRole("button", { name: "Por que MGLU3 caiu?" })).toBeInTheDocument();
    const campo = screen.getByLabelText("Pergunta para o analista");
    expect(campo).toHaveAttribute("maxLength", "500");
    expect(screen.getByRole("button", { name: "Perguntar" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "oi" } });
    expect(screen.getByRole("button", { name: "Perguntar" })).toBeEnabled();
    await semViolacoes(container);
  });
});
