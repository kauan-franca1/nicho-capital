"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { EventoAgente } from "@/lib/agent/run";
import type { Fonte } from "@/lib/agent/tools";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";

import { Answer } from "./answer";

type Passo = Extract<EventoAgente, { tipo: "passo" }>;
type Modo = Extract<EventoAgente, { tipo: "modo" }>;

type Troca = {
  pergunta: string;
  passos: Passo[];
  texto: string;
  fontes: Fonte[];
  modo: Modo | null;
  estado: "rodando" | "pronto" | "erro";
  erro?: string;
};

const MAX = 500;
const GLIFO = { rodando: "…", ok: "✓", erro: "✕" } as const;

function rotuloModo(m: Modo | null): string {
  if (!m) return "";
  if (m.modo === "guarda") return "Regra de conformidade: sem recomendação";
  if (m.modo === "regras") return `Sem LLM: resposta por regras${m.motivo ? ` (${m.motivo})` : ""}`;
  return `${m.provedor ?? "LLM"} · ${m.modelo ?? ""}${m.motivo ? ` (${m.motivo})` : ""}`;
}

/** Aplica um evento do stream à troca atual (função pura, testável). */
export function aplicar(t: Troca, ev: EventoAgente): Troca {
  switch (ev.tipo) {
    case "modo":
      return { ...t, modo: ev };
    case "passo": {
      const i = t.passos.findIndex((p) => p.id === ev.id);
      const passos = i >= 0 ? t.passos.map((p, j) => (j === i ? ev : p)) : [...t.passos, ev];
      return { ...t, passos };
    }
    case "texto":
      return { ...t, texto: t.texto + ev.delta };
    case "fontes":
      return { ...t, fontes: ev.fontes };
    case "fim":
      return { ...t, estado: "pronto" };
  }
}

export function Chat({ sugestoes }: { sugestoes: string[] }) {
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [entrada, setEntrada] = useState("");
  const rodando = trocas.at(-1)?.estado === "rodando";
  const id = useId();
  const fim = useRef<HTMLDivElement>(null);

  async function perguntar(pergunta: string) {
    const q = pergunta.trim();
    if (!q || rodando) return;
    setEntrada("");
    const atualizar = (f: (t: Troca) => Troca) =>
      setTrocas((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])]);
    setTrocas((ts) => [
      ...ts,
      { pergunta: q, passos: [], texto: "", fontes: [], modo: null, estado: "rodando" },
    ]);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: q }),
      });
      if (!r.ok || !r.body) {
        const erro =
          ((await r.json().catch(() => ({}))) as { erro?: string }).erro ?? `Erro ${r.status}`;
        atualizar((t) => ({ ...t, estado: "erro", erro }));
        return;
      }
      const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buffer += value;
        const linhas = buffer.split("\n");
        buffer = linhas.pop() ?? "";
        for (const l of linhas) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l) as EventoAgente;
          atualizar((t) => aplicar(t, ev));
        }
        fim.current?.scrollIntoView({ block: "nearest" });
      }
      atualizar((t) => (t.estado === "rodando" ? { ...t, estado: "pronto" } : t));
    } catch {
      atualizar((t) => ({ ...t, estado: "erro", erro: "Sem conexão com o servidor." }));
    }
  }

  return (
    <div className="flex flex-col gap-16">
      {trocas.length === 0 ? (
        <section aria-labelledby={`${id}-sug`} className="flex flex-col gap-8">
          <h2 id={`${id}-sug`} className="text-label font-medium uppercase text-muted">
            Experimente
          </h2>
          <ul className="flex flex-wrap gap-8">
            {sugestoes.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => perguntar(s)}
                  className="rounded-md border border-default bg-surface-2 px-12 py-8 text-left text-small transition-colors duration-(--duration-fast) hover:bg-surface-3"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-16">
        {trocas.map((t, i) => (
          <article
            key={i}
            className="flex flex-col gap-12 rounded-lg border border-default bg-surface-2 p-16"
          >
            <p className="font-serif text-heading-sm font-normal text-primary">{t.pergunta}</p>
            {t.modo ? (
              <p className="text-label uppercase text-muted">{rotuloModo(t.modo)}</p>
            ) : null}

            {t.passos.length ? (
              <ol className="flex flex-col gap-4 text-small" aria-label="Passos da análise">
                {t.passos.map((p) => (
                  <li
                    key={p.id}
                    className={cn(
                      "flex items-baseline gap-8",
                      p.status === "rodando" ? "text-primary" : "text-muted",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "w-12 font-mono",
                        p.status === "rodando" && "animate-pulse motion-reduce:animate-none",
                      )}
                    >
                      {GLIFO[p.status]}
                    </span>
                    <span>
                      {p.status === "rodando" ? p.texto : (p.resumo ?? p.texto)}
                      <span className="sr-only">
                        {" "}
                        (
                        {p.status === "rodando"
                          ? "em andamento"
                          : p.status === "ok"
                            ? "concluído"
                            : "falhou"}
                        )
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}

            {t.texto ? <Answer texto={t.texto} fontes={t.fontes} /> : null}
            {t.estado === "erro" ? (
              <p role="alert" className="rounded-md border-2 border-primary p-12 text-small">
                {t.erro}
              </p>
            ) : null}

            {t.fontes.length ? (
              <section aria-label="Fontes" className="border-t border-default pt-8">
                <h3 className="mb-4 text-label font-medium uppercase text-muted">Fontes</h3>
                <ol className="flex flex-col gap-6 text-small">
                  {t.fontes.map((f) => (
                    <li key={f.n} className="flex min-w-0 gap-8">
                      <span className="shrink-0 tabular-nums text-muted">[{f.n}]</span>
                      <span className="flex min-w-0 flex-col">
                        <a
                          href={f.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-words text-link hover:underline"
                        >
                          {f.titulo}
                          <span className="sr-only"> (abre em nova aba)</span>
                        </a>
                        <span className="text-muted">
                          {f.origem}
                          {f.data
                            ? ` · ${f.data.length === 10 ? formatDateBr(f.data) : formatDateTimeBr(f.data)}`
                            : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {t.estado !== "rodando" && t.passos.length ? (
              <details className="rounded-md border border-default text-small">
                <summary className="cursor-pointer px-12 py-6 text-muted hover:text-primary">
                  Ferramentas usadas ({t.passos.length})
                </summary>
                <ul className="flex flex-col gap-6 px-12 pb-8">
                  {t.passos.map((p) => (
                    <li key={p.id} className="flex flex-col">
                      <code className="break-all font-mono text-primary">
                        {p.ferramenta}({p.args ? JSON.stringify(p.args) : ""})
                      </code>
                      <span className="text-muted">
                        {p.resumo ?? "—"}
                        {p.ms !== undefined ? ` · ${p.ms} ms` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>
        ))}
        <div ref={fim} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perguntar(entrada);
        }}
        className="flex flex-col gap-4"
      >
        <label htmlFor={`${id}-q`} className="sr-only">
          Pergunta para o analista
        </label>
        <div className="flex gap-8">
          <input
            id={`${id}-q`}
            value={entrada}
            maxLength={MAX}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="Ex.: Por que PETR4 caiu hoje?"
            className="min-w-0 flex-1 rounded-md border border-(--color-iron-peak) bg-surface-2 p-12 text-body placeholder:text-muted"
            disabled={rodando}
          />
          <Button type="submit" disabled={rodando || !entrada.trim()}>
            {rodando ? "Analisando…" : "Perguntar"}
          </Button>
        </div>
        <p className="text-small text-muted">
          {entrada.length}/{MAX} · Não faz recomendação de compra ou venda. Toda afirmação cita a
          fonte.
        </p>
      </form>
    </div>
  );
}
