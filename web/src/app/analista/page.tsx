import type { Metadata } from "next";

import { Chat } from "@/components/agent/chat";
import { PageHeader } from "@/components/page-header";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { SUGESTOES } from "@/lib/agent/prompt";
import { getMeta } from "@/lib/data/source";

export const metadata: Metadata = { title: "Analista" };

export default async function AnalistaPage() {
  const meta = await getMeta();
  return (
    <>
      <PageHeader
        title="Analista"
        subtitle="Pergunte sobre o mercado. Cada resposta cita as fontes e mostra as ferramentas consultadas."
        aside={<StaleDataStamp lastUpdated={meta.lastUpdated} />}
      />
      <div className="mx-auto max-w-[820px]">
        <Chat sugestoes={SUGESTOES} />
      </div>
    </>
  );
}
