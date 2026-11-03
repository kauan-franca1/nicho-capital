import "katex/dist/katex.min.css";

import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { PageHeader } from "@/components/page-header";
import { carregarMetodologia } from "@/lib/methodology";

export const metadata: Metadata = { title: "Metodologia" };

async function docs() {
  "use cache";
  cacheLife("days");
  return carregarMetodologia();
}

/** "Metodologia: grafos" → "Grafos" (o sumário já está sob o título Metodologia). */
function rotulo(titulo: string): string {
  const t = titulo.replace(/^Metodologia:?\s*/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function MetodologiaPage() {
  const lista = await docs();
  return (
    <>
      <PageHeader
        title="Metodologia"
        subtitle="Como cada número do Nicho Capital é calculado: fórmulas, parâmetros, regras e limitações. É o mesmo texto da pasta docs/ do repositório."
      />
      <div className="grid gap-32 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sumário da metodologia" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="flex flex-col gap-12 text-data">
            {lista.map((d) => (
              <li key={d.id}>
                <a
                  href={`#${d.id}`}
                  className="inline-block py-4 font-medium text-primary hover:underline"
                >
                  {rotulo(d.titulo)}
                </a>
                <ol className="mt-4 flex flex-col gap-2 border-l border-default pl-8">
                  {d.secoes
                    .filter((s) => s.nivel === 2)
                    .map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className="inline-block py-4 text-small text-muted hover:text-primary"
                        >
                          {s.titulo}
                        </a>
                      </li>
                    ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-48">
          {lista.map((d) => (
            <section key={d.id} aria-labelledby={d.id} className="min-w-0">
              <h2
                id={d.id}
                className="mb-16 border-b border-default pb-8 font-serif text-heading font-normal"
              >
                {d.titulo}
              </h2>
              {/* HTML gerado no servidor a partir de docs/ do repositório (não é entrada de usuário). */}
              <div className="prosa" dangerouslySetInnerHTML={{ __html: d.html }} />
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
