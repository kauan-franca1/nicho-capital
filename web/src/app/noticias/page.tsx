import type { Metadata } from "next";

import { NewsFeed } from "@/components/news/news-feed";
import { StoryCard } from "@/components/news/story-card";
import { PageHeader } from "@/components/page-header";
import { StaleDataStamp } from "@/components/stale-data-stamp";
import { EmptyState } from "@/components/states";
import { getHistorias, getMeta, getNlpInfo } from "@/lib/data/source";
import { formatNumber } from "@/lib/format";
import { universe } from "@/lib/universe";

export const metadata: Metadata = { title: "Notícias" };

/** A página mostra as mais relevantes; o agente busca nas 800 do snapshot (prompt §8: Lighthouse). */
const MAX_FEED = 150;

export default async function NoticiasPage() {
  const [meta, todas, nlp] = await Promise.all([getMeta(), getHistorias(), getNlpInfo()]);
  const historias = todas.slice(0, MAX_FEED); // já vêm ordenadas por relevância
  const setorDoTicker = Object.fromEntries(universe.ativos.map((a) => [a.ticker, a.setor]));
  const porRegras = nlp.extracoes.filter((e) => e.metodo === "regras").reduce((s, e) => s + e.n, 0);
  const porLlm = nlp.extracoes.filter((e) => e.metodo === "llm").reduce((s, e) => s + e.n, 0);

  return (
    <>
      <PageHeader
        title="Notícias"
        subtitle="Histórias deduplicadas de várias fontes, com o motivo de cada uma ser relevante."
        aside={<StaleDataStamp lastUpdated={meta.lastUpdated} />}
      />
      {historias.length === 0 ? (
        <EmptyState title="Ainda não há histórias">
          Rode <code className="font-mono text-small">nicho ingest noticias</code>,{" "}
          <code className="font-mono text-small">nicho enriquecer</code> e{" "}
          <code className="font-mono text-small">nicho pontuar</code>.
        </EmptyState>
      ) : (
        <NewsFeed
          historias={historias.map(({ id, tickers, tipoEvento, sentimento, score }) => ({
            id,
            tickers,
            tipoEvento,
            sentimento,
            score,
          }))}
          cards={historias.map((h) => (
            <StoryCard key={h.id} historia={h} />
          ))}
          setores={universe.setores}
          setorDoTicker={setorDoTicker}
        />
      )}
      <p className="mt-24 max-w-[760px] text-small text-muted">
        Guardamos só título, link, fonte, data e o resumo que cada fonte publica; o texto completo
        fica no site de origem. Extrações: {porLlm} por LLM e {porRegras} por regras.
        {nlp.concordancia?.kappa != null
          ? ` Concordância de sentimento LLM × FinBERT: κ = ${formatNumber(nlp.concordancia.kappa, 2)} (n = ${nlp.concordancia.n}).`
          : " A concordância LLM × FinBERT aparece quando houver extrações por LLM."}
      </p>
    </>
  );
}
