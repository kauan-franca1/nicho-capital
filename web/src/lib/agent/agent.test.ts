import { describe, expect, it, vi } from "vitest";

import { planejar, textoExplicacao } from "./deterministic";
import { resolverNo, resolverSetor, resolverTicker } from "./entities";
import { chatStream, provedoresDisponiveis, ProvedorIndisponivel, type Provedor } from "./llm";
import { pedeRecomendacao } from "./prompt";
import { LimitePorIp } from "./rate-limit";
import { buscarHistorias, termos } from "./search";
import { RegistroFontes } from "./tools";

// Fora do Next, `cacheLife` não tem contexto de cache: vira no-op nos testes.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

describe("resolução de entidades", () => {
  it("acha ticker por código, nome e apelido", () => {
    expect(resolverTicker("Por que mglu3 caiu?")).toBe("MGLU3");
    expect(resolverTicker("Quais os fatos relevantes recentes da Petrobras?")).toMatch(/^PETR/);
    expect(resolverTicker("como foi o dia do mercado")).toBeNull();
  });

  it("acha setor por sinônimo de mercado", () => {
    expect(resolverSetor("Resuma o que aconteceu com bancos esta semana.")).toBe("financeiro");
    expect(resolverSetor("e as varejistas?")).toBe("consumo");
  });

  it("aproxima fatores fora do universo e diz isso", () => {
    const no = resolverNo("Quais empresas são mais afetadas se o minério cair?");
    expect(no?.id).toBe("empresa:VALE3");
    expect(no?.nota).toMatch(/aproximado/);
    expect(resolverNo("e se VALE3 cair?")).toEqual({ id: "empresa:VALE3", nota: null });
  });
});

describe("planejamento sem LLM", () => {
  it("roteia as perguntas sugeridas para a intenção certa", () => {
    expect(planejar("Por que MGLU3 caiu?")).toEqual({
      intencao: "explicar",
      ticker: "MGLU3",
      direcao: "queda",
    });
    expect(planejar("Quais empresas são mais afetadas se o minério cair?").intencao).toBe("choque");
    expect(planejar("Resuma o que aconteceu com bancos esta semana.")).toMatchObject({
      intencao: "setor",
      setor: "financeiro",
      dias: 5,
    });
    expect(planejar("Quais os fatos relevantes recentes da Petrobras?").intencao).toBe(
      "documentos",
    );
    expect(planejar("Como está a Selic e a inflação?").intencao).toBe("macro");
    expect(planejar("oi").intencao).toBe("ajuda");
  });

  it("texto de explicação cita as fontes e a confiança", () => {
    const t = textoExplicacao({
      ticker: "MGLU3",
      pregao: "2026-10-26",
      retorno_pct: -10,
      ibovespa_pct: -2,
      retorno_anormal_pct: -7,
      hipoteses: [
        { hipotese: "Notícia da empresa", confianca: "alta", evidencia: "Resultado fraco" },
      ] as unknown as Parameters<typeof textoExplicacao>[0]["hipoteses"],
      noticias_da_empresa: [{ ref: [1], titulo: "Resultado fraco" }],
      noticias_de_mercado: [],
    });
    expect(t).toContain("[1]");
    expect(t).toMatch(/confiança alta/);
    expect(t).not.toMatch(/\b(compre|venda)\b/i);
  });
});

describe("guarda de conformidade", () => {
  it("detecta pedido de recomendação", () => {
    expect(pedeRecomendacao("Devo comprar PETR4?")).toBe(true);
    expect(pedeRecomendacao("Qual o preço-alvo da Vale?")).toBe(true);
    expect(pedeRecomendacao("compro ou vendo ITUB4?")).toBe(true);
    expect(pedeRecomendacao("Por que PETR4 caiu?")).toBe(false);
  });
});

describe("limite por IP", () => {
  it("bloqueia acima do máximo e libera após a janela", () => {
    let agora = 0;
    const l = new LimitePorIp(2, 60_000, () => agora);
    expect(l.consumir("a")).toBe(0);
    expect(l.consumir("a")).toBe(0);
    expect(l.consumir("a")).toBe(60);
    expect(l.consumir("b")).toBe(0);
    agora = 60_001;
    expect(l.consumir("a")).toBe(0);
  });
});

describe("fontes numeradas", () => {
  it("reaproveita o número para o mesmo link", () => {
    const f = new RegistroFontes();
    const a = f.adicionar({ titulo: "A", link: "https://x/a", origem: "X", data: "2026-10-30" });
    const b = f.adicionar({ titulo: "B", link: "https://x/b", origem: "X", data: "2026-10-30" });
    expect([
      a,
      b,
      f.adicionar({ titulo: "A", link: "https://x/a", origem: "X", data: "" }),
    ]).toEqual([1, 2, 1]);
    expect(f.lista().map((x) => x.n)).toEqual([1, 2]);
  });
});

describe("busca de notícias (lexical)", () => {
  const h = (id: string, titulo: string, tickers: string[], score = 0.5) => ({
    id,
    titulo,
    resumo: null,
    itens: [],
    tickers,
    ultimaEm: "2026-10-30T10:00:00Z",
    score,
  });
  const historias = [
    h("1", "Vale anuncia recompra de ações", ["VALE3"]),
    h("2", "Petrobras reduz preço do diesel", ["PETR4"], 0.9),
    h("3", "Minério de ferro recua na China", ["VALE3"], 0.2),
  ] as unknown as Parameters<typeof buscarHistorias>[0];

  it("tira acentos e palavras vazias", () => {
    expect(termos("Por que o minério caiu?")).toEqual(["minerio", "caiu"]);
  });

  it("ordena por termos encontrados e filtra por ticker", async () => {
    const r = await buscarHistorias(historias, "minério de ferro", { media: null });
    expect(r.metodo).toBe("lexical");
    expect(r.historias.map((x) => x.id)).toEqual(["3"]);
    const v = await buscarHistorias(historias, "", { ticker: "VALE3", media: null });
    expect(v.historias.map((x) => x.id).sort()).toEqual(["1", "3"]);
  });
});

// ------------------------------------------------------------------ cliente LLM
function sse(linhas: string[]): Response {
  const corpo = linhas.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(
    new ReadableStream({
      start(c) {
        // Fatia no meio para testar o buffer de linhas.
        const bytes = new TextEncoder().encode(corpo);
        const meio = Math.floor(bytes.length / 2);
        c.enqueue(bytes.slice(0, meio));
        c.enqueue(bytes.slice(meio));
        c.close();
      },
    }),
    { status: 200 },
  );
}

const groq: Provedor = {
  nome: "groq",
  modelo: "m",
  baseUrl: "https://api.groq.test/v1",
  chave: "k",
};

async function coletar<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}

describe("chatStream", () => {
  it("emite texto e monta chamadas de ferramenta fatiadas", async () => {
    const f = vi.fn(async () =>
      sse([
        JSON.stringify({ choices: [{ delta: { content: "Olá" } }] }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "get_quote", arguments: '{"tick' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'er":"VALE3"}' } }] } },
          ],
        }),
      ]),
    );
    const ev = await coletar(
      chatStream(groq, [{ role: "user", content: "x" }], [{}], {
        exigirFerramenta: true,
        f: f as unknown as typeof fetch,
      }),
    );
    expect(ev[0]).toEqual({ tipo: "texto", delta: "Olá" });
    expect(ev[1]).toEqual({
      tipo: "ferramentas",
      chamadas: [
        {
          id: "c1",
          type: "function",
          function: { name: "get_quote", arguments: '{"ticker":"VALE3"}' },
        },
      ],
    });
    const corpo = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(corpo.tool_choice).toBe("required");
    expect(corpo.stream).toBe(true);
  });

  it("não manda tool_choice ao Ollama", async () => {
    const f = vi.fn(async () => sse([]));
    await coletar(
      chatStream({ ...groq, nome: "ollama", chave: null }, [], [{}], {
        exigirFerramenta: true,
        f: f as unknown as typeof fetch,
      }),
    );
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).tool_choice).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("HTTP de erro vira ProvedorIndisponivel (para o fallback)", async () => {
    const f = vi.fn(async () => new Response("quota", { status: 429 }));
    await expect(
      coletar(chatStream(groq, [], [], { f: f as unknown as typeof fetch })),
    ).rejects.toBeInstanceOf(ProvedorIndisponivel);
  });
});

describe("provedoresDisponiveis", () => {
  it("usa só quem tem chave; Ollama só com o modelo instalado", async () => {
    const semOllama = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await provedoresDisponiveis({}, semOllama as unknown as typeof fetch)).toEqual([]);

    const env = { GROQ_API_KEY: "g" };
    const nomes = (await provedoresDisponiveis(env, semOllama as unknown as typeof fetch)).map(
      (p) => p.nome,
    );
    expect(nomes).toEqual(["groq"]);

    const comModelo = vi.fn(async () => Response.json({ models: [{ name: "qwen2.5:7b" }] }));
    const lista = await provedoresDisponiveis({}, comModelo as unknown as typeof fetch);
    expect(lista.map((p) => p.nome)).toEqual(["ollama"]);
    expect(lista[0].baseUrl).toBe("http://localhost:11434/v1");
  });
});

// ------------------------------------------------------------------ ponta a ponta sem LLM
describe("rodarAgente em modo regras (snapshot real)", () => {
  it("explica a queda da MGLU3 com passos, texto e fontes", async () => {
    const { rodarAgente } = await import("./run");
    const ev = await coletar(rodarAgente("Por que MGLU3 caiu?", { provedores: [] }));
    expect(ev[0]).toMatchObject({ tipo: "modo", modo: "regras" });
    const passos = ev.filter((e) => e.tipo === "passo");
    expect(passos.some((p) => p.tipo === "passo" && p.ferramenta === "explain_move")).toBe(true);
    expect(passos.every((p) => p.tipo === "passo" && p.status !== "erro")).toBe(true);
    const texto = ev.map((e) => (e.tipo === "texto" ? e.delta : "")).join("");
    expect(texto).toMatch(/MGLU3|Magazine/);
    expect(texto).not.toMatch(/Não encontrei dados/);
    // O último pregão foi de alta: a pergunta "caiu" deve explicar a queda da semana.
    expect(texto).toMatch(/variou −/);
    expect(texto).not.toMatch(/\d\.\d{2}%/); // números em pt-BR
    expect(ev.at(-1)).toEqual({ tipo: "fim" });
    expect(ev.at(-2)?.tipo).toBe("fontes");
  }, 30_000);

  it("recusa recomendação sem chamar ferramentas", async () => {
    const { rodarAgente } = await import("./run");
    const ev = await coletar(rodarAgente("Devo comprar MGLU3?", { provedores: [] }));
    expect(ev[0]).toEqual({ tipo: "modo", modo: "guarda" });
    expect(ev.some((e) => e.tipo === "passo")).toBe(false);
  });

  it.each([
    "Quais empresas são mais afetadas se o minério cair?",
    "Resuma o que aconteceu com bancos esta semana.",
    "Quais os fatos relevantes recentes da Petrobras?",
    "Como está a Selic e a inflação?",
  ])(
    "responde à sugestão %s sem erro",
    async (q) => {
      const { rodarAgente } = await import("./run");
      const ev = await coletar(rodarAgente(q, { provedores: [] }));
      const texto = ev.map((e) => (e.tipo === "texto" ? e.delta : "")).join("");
      expect(texto.length).toBeGreaterThan(40);
      expect(ev.filter((e) => e.tipo === "passo" && e.status === "erro")).toEqual([]);
    },
    30_000,
  );
});
