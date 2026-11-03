import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import llm from "@/generated/llm.json";
import { getExecucoes, getMeta } from "@/lib/data/source";
import type { Execucao } from "@/lib/data/types";
import { formatDateTimeBr, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Status" };

// C12: status por texto, peso e borda; nunca por cor.
const VARIANTE = {
  ok: "outline",
  parcial: "dashed",
  falhou: "strong",
  rodando: "default",
} as const;
const ROTULO = { ok: "OK", parcial: "Parcial", falhou: "Falhou", rodando: "Rodando" };

function duracao(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${formatNumber(ms / 1000, 1)} s`;
}

function contagens(c: Record<string, number>): string {
  const e = Object.entries(c);
  return e.length ? e.map(([k, v]) => `${k}: ${v}`).join(" · ") : "—";
}

async function Execucoes() {
  const [meta, runs] = await Promise.all([getMeta(), getExecucoes()]);
  if (!runs.length) {
    return (
      <EmptyState title="Nenhuma execução registrada">
        Rode <code className="font-mono">nicho rodar</code> no pipeline.
      </EmptyState>
    );
  }
  // Última execução de cada etapa, na ordem do pipeline.
  const ultima = new Map<string, Execucao>();
  for (const r of runs) if (!ultima.has(r.etapa)) ultima.set(r.etapa, r);
  const etapas = [...ultima.values()];
  const com = (s: Execucao["status"]) =>
    etapas
      .filter((r) => r.status === s)
      .map((r) => r.etapa)
      .join(", ");
  const falhas = com("falhou");
  const parciais = com("parcial");
  return (
    <div className="flex flex-col gap-24">
      <p className="text-body">
        {falhas ? `Com falha na última execução: ${falhas}. ` : ""}
        {parciais ? `Parciais (alguma fonte não respondeu): ${parciais}. ` : ""}
        {!falhas && !parciais ? "Todas as etapas terminaram bem na última execução. " : ""}
        <span className="text-muted">
          Fonte: {meta.kind === "snapshot" ? "snapshot do modo demo" : "tabela pipeline_runs"}.
        </span>
      </p>

      <Card aria-labelledby="ultimas">
        <h2 id="ultimas" className="mb-12 text-label font-medium uppercase text-muted">
          Última execução de cada etapa
        </h2>
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {[...ultima.values()].map((r) => (
            <li key={r.etapa} className="flex items-center justify-between gap-8 text-data">
              <span className="font-mono">{r.etapa}</span>
              <span className="flex items-center gap-8 text-muted">
                {formatDateTimeBr(r.iniciadoEm)}
                <Badge variant={VARIANTE[r.status]}>{ROTULO[r.status]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="historico" className="overflow-x-auto">
        <h2 id="historico" className="mb-12 text-label font-medium uppercase text-muted">
          Histórico ({runs.length} execuções)
        </h2>
        <table className="w-full min-w-[640px] text-left text-data">
          <thead className="text-label uppercase text-muted">
            <tr className="border-b border-default">
              <th scope="col" className="py-6 pr-12 font-medium">
                Etapa
              </th>
              <th scope="col" className="py-6 pr-12 font-medium">
                Status
              </th>
              <th scope="col" className="py-6 pr-12 font-medium">
                Início
              </th>
              <th scope="col" className="py-6 pr-12 text-right font-medium">
                Duração
              </th>
              <th scope="col" className="py-6 pr-12 font-medium">
                Contagens
              </th>
              <th scope="col" className="py-6 font-medium">
                Gatilho
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i} className="border-b border-default align-top">
                <td className="py-6 pr-12 font-mono">{r.etapa}</td>
                <td className="py-6 pr-12">
                  <Badge variant={VARIANTE[r.status]}>{ROTULO[r.status]}</Badge>
                  {r.erro ? <p className="mt-4 text-small text-muted">{r.erro}</p> : null}
                </td>
                <td className="py-6 pr-12 tabular-nums">{formatDateTimeBr(r.iniciadoEm)}</td>
                <td className="py-6 pr-12 text-right tabular-nums">{duracao(r.duracaoMs)}</td>
                <td className="py-6 pr-12 text-small text-muted">{contagens(r.contagens)}</td>
                <td className="py-6 text-small text-muted">{r.gatilho}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function StatusPage() {
  const provedores = llm.cadeia.map((n) => ({
    nome: n,
    ...llm.provedores[n as keyof typeof llm.provedores],
  }));
  return (
    <>
      <PageHeader
        title="Status"
        subtitle="Saúde do pipeline, últimas execuções e as cotas gratuitas de que ele depende."
      />
      <div className="flex flex-col gap-24">
        <Suspense fallback={<Skeleton className="h-[320px]" />}>
          <Execucoes />
        </Suspense>

        <Card aria-labelledby="agenda">
          <h2 id="agenda" className="mb-12 text-label font-medium uppercase text-muted">
            Agenda e cotas (camadas gratuitas)
          </h2>
          <ul className="flex flex-col gap-6 text-body">
            <li>
              Pipeline no GitHub Actions: dias úteis às 09:00 (briefing antes das 10h) e às 18:30
              (pós-fechamento), horário de Brasília. Um heartbeat diário evita a pausa do Supabase
              Free após 7 dias sem uso.
            </li>
            {provedores.map((p) => (
              <li key={p.nome}>
                <span className="font-medium">{p.nome}</span> ({p.modelo}):{" "}
                {p.rpm ? `${p.rpm} req/min` : "sem limite de API"}
                {p.rpd ? `, ${p.rpd} req/dia` : ""}
                {p.envChave ? ` · chave em ${p.envChave}` : " · local, sem chave"}
              </li>
            ))}
          </ul>
          <p className="mt-12 text-small text-muted">
            Limites conforme a documentação dos provedores, registrados em config/llm.yaml. O agente
            limita a 10 perguntas por minuto por IP para proteger essas cotas.
          </p>
        </Card>
      </div>
    </>
  );
}
