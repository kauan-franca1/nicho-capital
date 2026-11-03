import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/delta";
import { EmptyState } from "@/components/states";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { IntradayPoint } from "@/lib/data/types";
import {
  describePercent,
  formatBRL,
  formatDateBr,
  formatMonthBr,
  formatNumber,
} from "@/lib/format";
import type { DailyChange, MacroSummary, SectorPerformance } from "@/lib/market";
import { findAtivo } from "@/lib/universe";

const SemDados = () => (
  <EmptyState title="Sem dados ainda" className="p-16">
    Rode o pipeline (<code className="font-mono text-small">nicho ingest precos</code>) ou use o
    snapshot de demo.
  </EmptyState>
);

// ------------------------------------------------------------------ Ibovespa
export function IbovespaCard({
  change,
  intraday,
}: {
  change: DailyChange | null;
  intraday: IntradayPoint[];
}) {
  return (
    <Card aria-labelledby="card-ibov">
      <CardHeader>
        <CardTitle id="card-ibov">Ibovespa</CardTitle>
        {change ? <span className="text-small text-muted">{formatDateBr(change.dia)}</span> : null}
      </CardHeader>
      {change ? (
        <div className="flex flex-col gap-12">
          <div className="flex items-baseline gap-12">
            <span className="text-heading font-medium tabular-nums">
              {formatNumber(change.close, 0)}
            </span>
            <Delta value={change.change} className="text-lead" />
          </div>
          <Sparkline
            values={intraday.map((p) => p.close)}
            reference={change.prevClose}
            label={`Ibovespa no pregão de ${formatDateBr(change.dia)}: ${describePercent(change.change)}, fechando em ${formatNumber(change.close, 0)} pontos. A linha tracejada é o fechamento anterior.`}
          />
          <p className="text-small text-muted">
            Fechamento anterior {formatNumber(change.prevClose, 0)} · intraday de 15 min
          </p>
        </div>
      ) : (
        <SemDados />
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ altas e baixas
function MoversList({ titulo, itens }: { titulo: string; itens: DailyChange[] }) {
  return (
    <div>
      <h3 className="mb-4 text-label font-medium uppercase text-muted">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="py-8 text-small text-muted">Nenhum ativo.</p>
      ) : (
        <table className="w-full text-data">
          <caption className="sr-only">{titulo} do último pregão</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Ativo</th>
              <th scope="col">Último</th>
              <th scope="col">Variação</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => (
              <tr key={c.ticker} className="border-b border-default last:border-0">
                <th scope="row" className="py-8 text-left font-normal">
                  <Link href={`/ativo/${c.ticker}`} className="group inline-flex flex-col">
                    <span className="font-mono tracking-[0.05em] text-primary group-hover:underline">
                      {c.ticker}
                    </span>
                    <span className="text-small text-muted">{findAtivo(c.ticker)?.nome}</span>
                  </Link>
                </th>
                <td className="py-8 text-right tabular-nums">{formatBRL(c.close)}</td>
                <td className="py-8 pl-12 text-right">
                  <Delta value={c.change} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function MoversCard({ altas, baixas }: { altas: DailyChange[]; baixas: DailyChange[] }) {
  return (
    <Card aria-labelledby="card-movers">
      <CardHeader>
        <CardTitle id="card-movers">Maiores altas e baixas</CardTitle>
      </CardHeader>
      {altas.length + baixas.length === 0 ? (
        <SemDados />
      ) : (
        <div className="grid gap-16 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
          <MoversList titulo="Altas" itens={altas} />
          <MoversList titulo="Baixas" itens={baixas} />
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ mapa setorial
/** Intensidade do tom (C1): |variação| de 3% ou mais satura em --heatmap-max-mix. */
function tint(change: number): string {
  const intensidade = Math.min(Math.abs(change) / 0.03, 1);
  const cor = change >= 0 ? "var(--color-data-up)" : "var(--color-data-down)";
  return `color-mix(in oklab, ${cor} calc(var(--heatmap-max-mix) * ${intensidade.toFixed(3)}), var(--surface-2))`;
}

export function SectorHeatmap({ setores }: { setores: SectorPerformance[] }) {
  return (
    <Card aria-labelledby="card-setores">
      <CardHeader>
        <CardTitle id="card-setores">Mapa setorial</CardTitle>
        <span className="text-small text-muted">média simples do setor</span>
      </CardHeader>
      {setores.length === 0 ? (
        <SemDados />
      ) : (
        <ul className="grid grid-cols-2 gap-4">
          {setores.map((s) => (
            <li
              key={s.setor}
              className="flex flex-col gap-2 rounded-md border border-default p-8"
              style={{ background: tint(s.change) }}
            >
              <span className="truncate text-small text-primary" title={s.nome}>
                {s.nome}
              </span>
              <span className="flex items-baseline justify-between gap-4">
                <Delta value={s.change} className="text-primary" />
                <span className="text-small text-primary tabular-nums">
                  {s.emAlta}/{s.total}
                  <span className="sr-only"> ativos em alta</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ macro
function MacroItem({
  rotulo,
  valor,
  detalhe,
  className,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-2 border-b border-default py-8 last:border-0", className)}
    >
      <dt className="text-label font-medium uppercase text-muted">{rotulo}</dt>
      <dd className="flex items-baseline gap-8">
        <span className="text-heading-sm font-medium tabular-nums">{valor}</span>
        <span className="text-small text-muted">{detalhe}</span>
      </dd>
    </div>
  );
}

export function MacroCard({ macro }: { macro: MacroSummary }) {
  const { selic, ipca, ptax } = macro;
  return (
    <Card aria-labelledby="card-macro">
      <CardHeader>
        <CardTitle id="card-macro">Macro</CardTitle>
        <span className="text-small text-muted">Banco Central (SGS)</span>
      </CardHeader>
      {!selic && !ipca && !ptax ? (
        <SemDados />
      ) : (
        <dl>
          {selic ? (
            <MacroItem
              rotulo="Selic (meta)"
              valor={`${formatNumber(selic.valor)}%`}
              detalhe="ao ano"
            />
          ) : null}
          {ipca ? (
            <MacroItem
              rotulo={`IPCA · ${formatMonthBr(ipca.mes)}`}
              valor={`${formatNumber(ipca.valor)}%`}
              detalhe={
                ipca.acumulado12m !== null
                  ? `${formatNumber(ipca.acumulado12m)}% em 12 meses`
                  : "no mês"
              }
            />
          ) : null}
          {ptax ? (
            <MacroItem
              rotulo={`Dólar PTAX · ${formatDateBr(ptax.dia)}`}
              valor={formatBRL(ptax.valor, 4)}
              detalhe={ptax.change !== null ? <Delta value={ptax.change} /> : "venda"}
            />
          ) : null}
        </dl>
      )}
    </Card>
  );
}
