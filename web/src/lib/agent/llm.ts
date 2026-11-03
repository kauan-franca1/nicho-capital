import llmConfig from "@/generated/llm.json";

/**
 * Cliente de chat com ferramentas e streaming, no formato compatível com OpenAI, que os três
 * provedores expõem (verificado na documentação em 31/10/2026):
 *   Gemini  https://generativelanguage.googleapis.com/v1beta/openai/  (beta)
 *   Groq    https://api.groq.com/openai/v1
 *   Ollama  {OLLAMA_BASE_URL}/v1                                     (sem tool_choice)
 * Fallback: Gemini → Groq → Ollama (ordem de config/llm.yaml).
 */

export type Mensagem =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChamadaFerramenta[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChamadaFerramenta = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type Provedor = { nome: string; modelo: string; baseUrl: string; chave: string | null };

const BASES: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
};

export class ProvedorIndisponivel extends Error {}

/** Provedores configurados (com chave, ou Ollama respondendo com o modelo instalado). */
export async function provedoresDisponiveis(
  env: Record<string, string | undefined> = process.env,
  f: typeof fetch = fetch,
): Promise<Provedor[]> {
  const out: Provedor[] = [];
  for (const nome of llmConfig.cadeia) {
    const p = llmConfig.provedores[nome as keyof typeof llmConfig.provedores];
    if (nome === "ollama") {
      const base = (p.envUrl && env[p.envUrl]?.trim()) || "http://localhost:11434";
      try {
        const r = await f(`${base}/api/tags`, { signal: AbortSignal.timeout(800) });
        const nomes: string[] = ((await r.json()).models ?? []).map(
          (m: { name: string }) => m.name,
        );
        if (nomes.some((n) => n === p.modelo || n.startsWith(`${p.modelo}:`))) {
          out.push({ nome, modelo: p.modelo, baseUrl: `${base}/v1`, chave: null });
        }
      } catch {
        // Ollama desligado: segue sem ele.
      }
      continue;
    }
    const chave = p.envChave ? env[p.envChave]?.trim() : undefined;
    if (chave) out.push({ nome, modelo: p.modelo, baseUrl: BASES[nome], chave });
  }
  return out;
}

export type EventoStream =
  { tipo: "texto"; delta: string } | { tipo: "ferramentas"; chamadas: ChamadaFerramenta[] };

/**
 * Uma volta de chat em streaming. Emite texto conforme chega; ao final, se o modelo pediu
 * ferramentas, emite as chamadas completas (argumentos chegam fatiados no stream).
 */
export async function* chatStream(
  p: Provedor,
  mensagens: Mensagem[],
  ferramentas: unknown[],
  opts: {
    exigirFerramenta?: boolean;
    temperatura?: number;
    f?: typeof fetch;
    timeoutMs?: number;
  } = {},
): AsyncGenerator<EventoStream> {
  const { exigirFerramenta = false, temperatura = 0.2, f = fetch, timeoutMs = 60000 } = opts;
  const corpo: Record<string, unknown> = {
    model: p.modelo,
    messages: mensagens,
    stream: true,
    temperature: temperatura,
  };
  if (ferramentas.length) {
    corpo.tools = ferramentas;
    // O Ollama não suporta tool_choice; nos outros, a 1ª volta exige ferramenta.
    if (p.nome !== "ollama") corpo.tool_choice = exigirFerramenta ? "required" : "auto";
  }
  let r: Response;
  try {
    r = await f(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.chave ? { Authorization: `Bearer ${p.chave}` } : {}),
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ProvedorIndisponivel(`${p.nome}: ${(e as Error).message}`);
  }
  if (!r.ok || !r.body) {
    const texto = await r.text().catch(() => "");
    throw new ProvedorIndisponivel(`${p.nome}: HTTP ${r.status} ${texto.slice(0, 160)}`);
  }

  const parciais = new Map<number, ChamadaFerramenta>();
  const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buffer += value;
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";
    for (const linha of linhas) {
      const l = linha.trim();
      if (!l.startsWith("data:")) continue;
      const dado = l.slice(5).trim();
      if (dado === "[DONE]") continue;
      let json: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      try {
        json = JSON.parse(dado);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) yield { tipo: "texto", delta: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index ?? parciais.size;
        const atual = parciais.get(i) ?? {
          id: tc.id ?? `chamada_${i}`,
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (tc.id) atual.id = tc.id;
        if (tc.function?.name) atual.function.name += tc.function.name;
        if (tc.function?.arguments) atual.function.arguments += tc.function.arguments;
        parciais.set(i, atual);
      }
    }
  }
  if (parciais.size) yield { tipo: "ferramentas", chamadas: [...parciais.values()] };
}
