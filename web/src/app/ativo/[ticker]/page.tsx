import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Loading from "@/app/loading";
import { PriceChart } from "@/components/charts/price-chart";
import { Delta } from "@/components/delta";
import { NeighborsCard } from "@/components/graphs/neighbors-card";
import { StoryCard } from "@/components/news/story-card";
import { PageHeader } from "@/components/page-header";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { AnomaliasCard, EventStudiesCard, GarchCard } from "@/components/stats/stats-cards";
import {
  getAssetStats,
  getDaily,
  getGrafos,
  getHistorias,
  getIntraday,
  getMeta,
} from "@/lib/data/source";
import { formatBRL, formatCompact, formatDateBr, formatNumber } from "@/lib/format";
import { assetStats, dailyChange, marcadoresDeEventos } from "@/lib/market";
import { vizinhanca } from "@/lib/graphs";
import { findAtivo, universe } from "@/lib/universe";

// Pré-renderiza o universo inteiro; qualquer outro ticker cai no notFound() abaixo.
// (`dynamicParams` não é compatível com cacheComponents.)
export function generateStaticParams() {
  return universe.ativos.map((a) => ({ ticker: a.ticker }));
}

export async function generateMetadata({
  params,
}: PageProps<"/ativo/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  const ativo = findAtivo(ticker);
  return { title: ativo ? `${ativo.ticker} — ${ativo.nome}` : "Ativo" };
}

// Com cacheComponents, um ticker fora do generateStaticParams é dado de runtime:
// o acesso a `params` precisa ficar dentro de <Suspense> para a navegação continuar instantânea.
export default function AtivoPage({ params }: PageProps<"/ativo/[ticker]">) {
  return (
    <Suspense fallback={<Loading />}>
      <AtivoConteudo params={params} />
    </Suspense>
  );
}

function Stat({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-label font-medium uppercase text-muted">{rotulo}</dt>
      <dd className="text-heading-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

const Retorno = ({ v }: { v: number | null }) =>
  v === null ? <span className="text-muted">—</span> : <Delta value={v} />;

async function AtivoConteudo({ params }: { params: PageProps<"/ativo/[ticker]">["params"] }) {
  const { ticker } = await params;
  const ativo = findAtivo(ticker);
  if (!ativo) notFound();

  const [meta, bars, intraday, estat, todas, grafos] = await Promise.all([
    getMeta(),
    getDaily(ativo.ticker),
    getIntraday(ativo.ticker),
    getAssetStats(ativo.ticker),
    getHistorias(),
    getGrafos(),
  ]);
  const historias = todas.filter((h) => h.tickers.includes(ativo.ticker));
  const eventos = marcadoresDeEventos(
    historias,
    ativo.ticker,
    bars.map((b) => b.dia),
  );
  const change = dailyChange(ativo.ticker, bars);
  const stats = assetStats(bars);

  return (
    <>
      <nav aria-label="Trilha" className="mb-16 text-data text-muted">
        <Link href="/" className="hover:text-primary">
          Mercado
        </Link>{" "}
        / <span className="text-primary">{ativo.ticker}</span>
      </nav>
      <PageHeader
        title={ativo.nome}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-8">
            <span className="font-mono tracking-[0.1em] text-primary">{ativo.ticker}</span>
            <Badge>{universe.setores[ativo.setor]}</Badge>
          </span>
        }
        aside={
          change ? (
            <div className="flex flex-col items-start gap-4 md:items-end">
              <div className="flex items-baseline gap-12">
                <span className="text-heading font-medium tabular-nums">
                  {formatBRL(change.close)}
                </span>
                <Delta value={change.change} className="text-lead" />
              </div>
              <span className="text-small text-muted">
                Fechamento de {formatDateBr(change.dia)}
              </span>
              <StaleDataStamp lastUpdated={meta.lastUpdated} />
            </div>
          ) : (
            <StaleDataStamp lastUpdated={meta.lastUpdated} />
          )
        }
      />

      {bars.length === 0 ? (
        <EmptyState title="Sem cotações para este ativo">
          O pipeline ainda não coletou dados de {ativo.ticker}.
        </EmptyState>
      ) : (
        <>
          <Card aria-labelledby="card-preco" className="mb-12">
            <CardHeader>
              <CardTitle id="card-preco">Preço</CardTitle>
              <span className="text-small text-muted">
                <span aria-hidden="true">■</span> documento da CVM ·{" "}
                <span aria-hidden="true">●</span> notícia de materialidade alta
              </span>
            </CardHeader>
            <PriceChart ticker={ativo.ticker} bars={bars} intraday={intraday} eventos={eventos} />
          </Card>

          <Card aria-labelledby="card-numeros" className="mb-12">
            <CardHeader>
              <CardTitle id="card-numeros">Números</CardTitle>
              <span className="text-small text-muted">retornos com preço ajustado a proventos</span>
            </CardHeader>
            <dl className="grid grid-cols-2 gap-16 sm:grid-cols-3 lg:grid-cols-6">
              <Stat rotulo="1 mês">
                <Retorno v={stats.retorno1m} />
              </Stat>
              <Stat rotulo="No ano">
                <Retorno v={stats.retornoAno} />
              </Stat>
              <Stat rotulo="12 meses">
                <Retorno v={stats.retorno12m} />
              </Stat>
              <Stat rotulo="Mín · máx 52 sem.">
                {stats.min52 !== null && stats.max52 !== null
                  ? `${formatNumber(stats.min52)} · ${formatNumber(stats.max52)}`
                  : "—"}
              </Stat>
              <Stat rotulo="Volatilidade 21d">
                {stats.vol21 !== null ? `${formatNumber(stats.vol21 * 100, 1)}% a.a.` : "—"}
              </Stat>
              <Stat rotulo="Volume médio 21d">
                {stats.volumeMedio21 !== null ? formatCompact(stats.volumeMedio21) : "—"}
              </Stat>
            </dl>
          </Card>
        </>
      )}

      {bars.length > 0 ? (
        <div className="mb-12 flex flex-col gap-12">
          <div className="grid gap-12 lg:grid-cols-2">
            <GarchCard
              ticker={ativo.ticker}
              garch={estat.garch}
              volatilidade={estat.volatilidade}
            />
            <AnomaliasCard anomalias={estat.anomalias} />
          </div>
          <EventStudiesCard ticker={ativo.ticker} estudos={estat.eventStudies} />
        </div>
      ) : null}

      <Card aria-labelledby="card-noticias" className="mb-12">
        <CardHeader>
          <CardTitle id="card-noticias">Notícias ranqueadas</CardTitle>
          <span className="text-small text-muted">
            {historias.length} {historias.length === 1 ? "história" : "histórias"} nos últimos 21
            dias
          </span>
        </CardHeader>
        {historias.length === 0 ? (
          <EmptyState title="Nenhuma história recente" className="p-16">
            Nenhuma notícia ou documento da CVM citou {ativo.nome} no período.
          </EmptyState>
        ) : (
          historias.slice(0, 8).map((h) => <StoryCard key={h.id} historia={h} />)
        )}
      </Card>

      <NeighborsCard ticker={ativo.ticker} v={vizinhanca(grafos, ativo.ticker)} />
    </>
  );
}
