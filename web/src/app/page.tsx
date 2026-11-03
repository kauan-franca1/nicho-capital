import Link from "next/link";

import { Delta } from "@/components/delta";
import {
  IbovespaCard,
  MacroCard,
  MoversCard,
  SectorHeatmap,
} from "@/components/market/market-cards";
import { StoryCard } from "@/components/news/story-card";
import { PageHeader } from "@/components/page-header";
import { PLACEHOLDER_RIDGE, RidgeLine } from "@/components/ridge-line";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { EmptyState } from "@/components/states";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { AnomaliaTable, anomaliasDoDia } from "@/components/stats/anomalies";
import {
  getIntraday,
  getMacro,
  getMeta,
  getHistorias,
  getRecentAnomalies,
  getRecentDaily,
} from "@/lib/data/source";
import { formatDateBr } from "@/lib/format";
import {
  changesOnDate,
  dailyChange,
  lastSession,
  macroSummary,
  sectorPerformance,
  topMovers,
} from "@/lib/market";
import { ativosPorSetor, universe } from "@/lib/universe";

export default async function HomePage() {
  const ibovTicker = universe.indice.ticker;
  const [meta, recent, intradayIbov, macro, anomalias, historias] = await Promise.all([
    getMeta(),
    getRecentDaily(260),
    getIntraday(ibovTicker),
    getMacro(),
    getRecentAnomalies(),
    getHistorias(),
  ]);
  const anomaliasHoje = anomaliasDoDia(anomalias, meta.ultimoPregao);

  const changes = changesOnDate(recent, meta.ultimoPregao);
  const byTicker = new Map(changes.map((c) => [c.ticker, c]));
  const ibov = dailyChange(ibovTicker, recent[ibovTicker] ?? []);
  const { altas, baixas } = topMovers(changes);
  const setores = sectorPerformance(universe, changes);
  const ridge = (recent[ibovTicker] ?? []).map((b) => b.close);
  const grupos = ativosPorSetor();

  return (
    <>
      <PageHeader
        title="O que mexeu na bolsa hoje"
        subtitle="Mercado, notícias e conexões entre empresas da B3, explicados antes da primeira ligação para o cliente."
        aside={<StaleDataStamp lastUpdated={meta.lastUpdated} />}
      />

      {meta.fallback ? (
        <p
          role="status"
          className="mb-16 rounded-md border border-dashed border-strong p-12 text-small"
        >
          O banco de dados não respondeu. Você está vendo o último snapshot salvo.
        </p>
      ) : null}

      <RidgeLine values={ridge.length > 1 ? ridge : PLACEHOLDER_RIDGE} className="mb-32" />

      <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-3">
        <IbovespaCard change={ibov} intraday={lastSession(intradayIbov)} />
        <MoversCard altas={altas} baixas={baixas} />
        <SectorHeatmap setores={setores} />
        <MacroCard macro={macroSummary(macro)} />
        <Card aria-labelledby="card-anomalias-dia" className="lg:col-span-2">
          <CardHeader>
            <CardTitle id="card-anomalias-dia">Anomalias do dia</CardTitle>
            {meta.ultimoPregao ? (
              <span className="text-small text-muted">{formatDateBr(meta.ultimoPregao)}</span>
            ) : null}
          </CardHeader>
          {anomaliasHoje.length === 0 ? (
            <EmptyState title="Nenhuma anomalia no último pregão" className="p-16">
              Nenhum ativo teve retorno ou volume além do limiar de z robusto (|z| ≥ 3) contra os 60
              pregões anteriores.
            </EmptyState>
          ) : (
            <AnomaliaTable
              anomalias={anomaliasHoje}
              comTicker
              caption="Anomalias do último pregão, das mais severas para as menos"
            />
          )}
        </Card>
        <Card aria-labelledby="card-historias" className="md:col-span-2 lg:col-span-3">
          <CardHeader>
            <CardTitle id="card-historias">Histórias mais relevantes</CardTitle>
            <Link href="/noticias" className="text-small text-link hover:underline">
              Ver todas e por que são relevantes →
            </Link>
          </CardHeader>
          {historias.length === 0 ? (
            <EmptyState title="Ainda não há histórias" className="p-16">
              Rode o pipeline de notícias (<code className="font-mono text-small">nicho rodar</code>
              ).
            </EmptyState>
          ) : (
            historias.slice(0, 5).map((h) => <StoryCard key={h.id} historia={h} compacto />)
          )}
        </Card>
      </div>

      <section aria-labelledby="universo" className="mt-(--section-gap)">
        <h2 id="universo" className="font-serif text-heading font-normal">
          Universo monitorado
        </h2>
        <p className="mt-8 text-lead text-muted">
          {universe.ativos.length} ativos líquidos do Ibovespa em {grupos.length} setores, além do
          próprio índice.
        </p>
        <div className="mt-24 grid gap-12 sm:grid-cols-2 lg:grid-cols-3">
          {grupos.map((g) => (
            <Card key={g.setor} aria-label={g.nome}>
              <CardHeader>
                <CardTitle>{g.nome}</CardTitle>
                <span className="text-small text-muted tabular-nums">{g.ativos.length}</span>
              </CardHeader>
              <ul className="flex flex-col">
                {g.ativos.map((a) => {
                  const c = byTicker.get(a.ticker);
                  return (
                    <li key={a.ticker} className="border-b border-default last:border-0">
                      <Link
                        href={`/ativo/${a.ticker}`}
                        className="flex items-baseline justify-between gap-8 py-6 transition-colors duration-(--duration-fast) hover:bg-surface-3"
                      >
                        <span className="flex items-baseline gap-8">
                          <span className="font-mono text-small tracking-[0.05em] text-primary">
                            {a.ticker}
                          </span>
                          <span className="truncate text-small text-muted">{a.nome}</span>
                        </span>
                        {c ? <Delta value={c.change} className="text-small" /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
