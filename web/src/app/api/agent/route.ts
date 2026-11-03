import { LimitePorIp, MAX_PERGUNTA } from "@/lib/agent/rate-limit";
import { rodarAgente } from "@/lib/agent/run";

// Agente com ferramentas (prompt §6). Resposta em NDJSON: um evento por linha, em streaming.
export const maxDuration = 60;

const limite = new LimitePorIp(10, 60_000);

function ipDe(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function POST(req: Request): Promise<Response> {
  const espera = limite.consumir(ipDe(req));
  if (espera > 0) {
    return Response.json(
      { erro: `Muitas perguntas seguidas. Tente de novo em ${espera} s.` },
      { status: 429, headers: { "Retry-After": String(espera) } },
    );
  }
  let pergunta = "";
  try {
    const corpo = (await req.json()) as { pergunta?: unknown };
    pergunta = typeof corpo.pergunta === "string" ? corpo.pergunta.trim() : "";
  } catch {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }
  if (!pergunta) return Response.json({ erro: "Faça uma pergunta." }, { status: 400 });
  if (pergunta.length > MAX_PERGUNTA) {
    return Response.json(
      { erro: `A pergunta pode ter no máximo ${MAX_PERGUNTA} caracteres.` },
      { status: 413 },
    );
  }

  const codificador = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controle) {
      const enviar = (ev: unknown) =>
        controle.enqueue(codificador.encode(JSON.stringify(ev) + "\n"));
      try {
        for await (const ev of rodarAgente(pergunta)) enviar(ev);
      } catch (e) {
        console.error("[agente]", e);
        enviar({
          tipo: "texto",
          delta: "\n\nTive um problema ao montar a resposta. Tente de novo em instantes.",
        });
        enviar({ tipo: "fim" });
      } finally {
        controle.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
