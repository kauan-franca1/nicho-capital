import type { Metadata } from "next";

import { GraphExplorerLazy } from "@/components/graphs/graph-explorer-lazy";
import { PageHeader } from "@/components/page-header";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { EmptyState } from "@/components/states";
import { getGrafos, getMeta } from "@/lib/data/source";
import { universe } from "@/lib/universe";

export const metadata: Metadata = { title: "Grafos" };

export default async function GrafosPage() {
  const [meta, grafos] = await Promise.all([getMeta(), getGrafos()]);
  return (
    <>
      <PageHeader
        title="Grafos"
        subtitle="Como as empresas se conectam e por onde um choque se propaga."
        aside={<StaleDataStamp lastUpdated={meta.lastUpdated} />}
      />
      {grafos.correlacao.length === 0 && !grafos.conhecimento ? (
        <EmptyState title="Ainda não há grafos">
          Rode <code className="font-mono text-small">nicho grafos</code> depois da coleta de preços
          e notícias.
        </EmptyState>
      ) : (
        <GraphExplorerLazy grafos={grafos} setores={universe.setores} />
      )}
    </>
  );
}
