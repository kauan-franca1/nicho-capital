import Link from "next/link";

import { EmptyState } from "@/components/states";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateBr, formatNumber } from "@/lib/format";
import type { Vizinhanca } from "@/lib/graphs";

const REL: Record<string, string> = {
  CONTROLA: "Controlador",
  PARTICIPA: "Acionista relevante",
  ADMINISTRA: "Administrador",
  CO_MENCIONADA_COM: "Citada junto",
};

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-8">
      <h3 className="text-label font-medium uppercase text-muted">{titulo}</h3>
      {children}
    </section>
  );
}

const Ticker = ({ t }: { t: string }) => (
  <Link
    href={`/ativo/${t}`}
    className="inline-block py-4 font-mono tracking-[0.05em] text-primary hover:underline"
  >
    {t}
  </Link>
);

export function NeighborsCard({ ticker, v }: { ticker: string; v: Vizinhanca }) {
  const vazio = !v.mst.length && !v.ligacoes.length && !v.choque.length;
  return (
    <Card aria-labelledby="card-vizinhos" className="mb-12">
      <CardHeader>
        <CardTitle id="card-vizinhos">Vizinhos no grafo</CardTitle>
        <Link href="/grafos" className="text-small text-link hover:underline">
          Explorar os grafos →
        </Link>
      </CardHeader>
      {vazio ? (
        <EmptyState title="Sem dados de grafo" className="p-16">
          Rode <code className="font-mono text-small">nicho grafos</code>.
        </EmptyState>
      ) : (
        <div className="grid gap-16 md:grid-cols-3">
          <Bloco
            titulo={`Árvore de correlação${v.referencia ? ` · ${formatDateBr(v.referencia)}` : ""}`}
          >
            <ul className="flex flex-col gap-4 text-small">
              {v.mst.map((m) => (
                <li key={m.ticker} className="flex justify-between">
                  <Ticker t={m.ticker} />
                  <span className="tabular-nums text-muted">ρ = {formatNumber(m.rho, 2)}</span>
                </li>
              ))}
            </ul>
            {v.comunidade.length ? (
              <p className="text-small text-muted">
                Mesma comunidade: <span className="font-mono">{v.comunidade.join(" ")}</span>
              </p>
            ) : null}
          </Bloco>
          <Bloco titulo="Controle, acionistas e conselhos">
            {v.ligacoes.length === 0 ? (
              <p className="text-small text-muted">
                Sem ligações societárias no Formulário de Referência.
              </p>
            ) : (
              <ul className="flex max-h-[220px] flex-col gap-6 overflow-y-auto text-small">
                {v.ligacoes.slice(0, 12).map((l, i) => (
                  <li key={i} className="flex flex-col">
                    <span className="text-primary">{l.rotulo}</span>
                    <span className="text-muted">
                      {REL[l.relacao] ?? l.relacao}
                      {l.detalhe ? ` · ${l.detalhe}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
          <Bloco titulo={`Choque em ${ticker} atinge primeiro`}>
            <ol className="flex flex-col gap-4 text-small">
              {v.choque.map((c) => (
                <li key={c.id} className="flex justify-between gap-8">
                  <span className="truncate">{c.rotulo}</span>
                  <span className="tabular-nums text-muted">{formatNumber(c.impacto, 0)}</span>
                </li>
              ))}
            </ol>
          </Bloco>
        </div>
      )}
    </Card>
  );
}
