import type { Metadata } from "next";

import { BriefingView } from "@/components/briefing/briefing-view";
import { PrintButton } from "@/components/briefing/print-button";
import { PageHeader } from "@/components/page-header";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { EmptyState } from "@/components/states";
import { getBriefings, getMeta } from "@/lib/data/source";
import { formatDateBr } from "@/lib/format";

export const metadata: Metadata = { title: "Briefing" };

export default async function BriefingPage() {
  const [meta, briefings] = await Promise.all([getMeta(), getBriefings()]);
  const [atual, ...anteriores] = briefings;
  return (
    <>
      <PageHeader
        title="Briefing"
        subtitle="O que um assessor precisa saber antes das 10h. Só dados do banco, com fonte em cada afirmação."
        aside={<StaleDataStamp lastUpdated={meta.lastUpdated} />}
      />
      <div className="mx-auto flex max-w-[760px] flex-col gap-32">
        {atual ? (
          <>
            <div className="flex justify-end" data-print="hide">
              <PrintButton />
            </div>
            <BriefingView b={atual} />
          </>
        ) : (
          <EmptyState title="Nenhum briefing gerado ainda">
            Rode <code className="font-mono">nicho briefing</code> no pipeline.
          </EmptyState>
        )}

        {anteriores.length ? (
          <section aria-labelledby="anteriores" className="flex flex-col gap-8" data-print="hide">
            <h2 id="anteriores" className="text-label font-medium uppercase text-muted">
              Edições anteriores
            </h2>
            {anteriores.map((b) => (
              <details key={b.dia} className="rounded-md border border-default">
                <summary className="cursor-pointer px-12 py-8 text-small hover:text-primary">
                  {formatDateBr(b.dia)} · versão {b.versao}
                </summary>
                <div className="p-16">
                  <BriefingView b={b} compacto />
                </div>
              </details>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}
