import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { ComponenteScore, Historia } from "@/lib/data/types";
import { formatDateBr, formatDateTimeBr, formatNumber } from "@/lib/format";

import { classeSentimento, GLIFO_SENTIMENTO, MATERIALIDADE, TIPO_EVENTO } from "./labels";

const ORDEM = [
  "materialidade",
  "reacao_mercado",
  "fontes_independentes",
  "sentimento_intensidade",
  "novidade",
  "recencia",
  "centralidade_grafo",
];

// Barra monocromática (C1/C12): segmentos alternam tons da escala de cinza, separados por 1 px.
const TONS = ["bg-primary", "bg-muted", "bg-(--color-smoke)", "bg-(--color-pewter)"];

export function componentesOrdenados(h: Historia): [string, ComponenteScore][] {
  return ORDEM.filter((k) => h.componentes[k]).map((k) => [k, h.componentes[k]]);
}

/** "Por que isso é relevante": contribuição de cada fator, em pontos (soma = score). */
export function ScoreBreakdown({ historia }: { historia: Historia }) {
  const comps = componentesOrdenados(historia);
  const disponiveis = comps.filter(([, c]) => c.disponivel && c.pontos > 0);
  return (
    <div className="flex flex-col gap-8">
      <div
        aria-hidden="true"
        className="flex h-8 w-full gap-[1px] overflow-hidden rounded-sm bg-surface-3"
      >
        {disponiveis.map(([k, c], i) => (
          <span key={k} className={TONS[i % TONS.length]} style={{ width: `${c.pontos}%` }} />
        ))}
      </div>
      <table className="w-full text-small">
        <caption className="sr-only">Decomposição do score de relevância</caption>
        <thead className="text-left text-label uppercase text-muted">
          <tr>
            <th scope="col" className="py-4 font-medium">
              Fator
            </th>
            <th scope="col" className="py-4 text-right font-medium">
              Intensidade
            </th>
            <th scope="col" className="py-4 text-right font-medium">
              Peso
            </th>
            <th scope="col" className="py-4 text-right font-medium">
              Pontos
            </th>
          </tr>
        </thead>
        <tbody>
          {comps.map(([k, c]) => (
            <tr key={k} className="border-t border-default">
              <th scope="row" className="py-4 pr-8 text-left font-normal">
                <span className="inline-flex items-center gap-8">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block size-8 rounded-[1px]",
                      c.disponivel && c.pontos > 0
                        ? TONS[disponiveis.findIndex(([kk]) => kk === k) % TONS.length]
                        : "border border-strong",
                    )}
                  />
                  {c.rotulo}
                  {k === "reacao_mercado" && c.pregao ? (
                    <span className="text-muted">({formatDateBr(c.pregao)})</span>
                  ) : null}
                </span>
              </th>
              <td className="py-4 text-right tabular-nums text-muted">
                {c.disponivel && c.fator !== null ? `${formatNumber(c.fator * 100, 0)}%` : "—"}
              </td>
              <td className="py-4 text-right tabular-nums text-muted">
                {c.disponivel ? `${formatNumber(c.pesoEfetivo * 100, 0)}%` : "fase 5"}
              </td>
              <td className="py-4 text-right font-medium tabular-nums">
                {c.disponivel ? formatNumber(c.pontos, 1) : "—"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-strong">
            <th scope="row" className="py-4 text-left font-medium">
              Score
            </th>
            <td />
            <td />
            <td className="py-4 text-right font-semibold tabular-nums">
              {formatNumber(historia.score, 1)}
            </td>
          </tr>
        </tbody>
      </table>
      <NotaExtracao historia={historia} />
    </div>
  );
}

function NotaExtracao({ historia: h }: { historia: Historia }) {
  if (h.extracao === "regras") {
    return (
      <p className="text-small text-muted">
        Extração por regras (nenhum LLM disponível nesta execução): tipo de evento e materialidade
        são aproximações por palavras-chave.
      </p>
    );
  }
  return null;
}

export function SentimentoTexto({ valor }: { valor: number | null }) {
  const c = classeSentimento(valor);
  if (!c) return null;
  return (
    <span className="text-small text-muted">
      <span aria-hidden="true" className="font-mono">
        {GLIFO_SENTIMENTO[c]}
      </span>{" "}
      sentimento {c}
    </span>
  );
}

export function StoryCard({
  historia,
  compacto = false,
}: {
  historia: Historia;
  compacto?: boolean;
}) {
  const h = historia;
  const principal = h.itens[0];
  return (
    <article
      aria-labelledby={`historia-${h.id}`}
      className="flex flex-col gap-8 border-b border-default py-16 first:pt-0 last:border-0"
    >
      <div className="flex items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-4">
          <h3 id={`historia-${h.id}`} className="text-body font-medium text-primary">
            {principal ? (
              <a
                href={principal.link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {h.titulo}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            ) : (
              h.titulo
            )}
          </h3>
          {h.resumo && h.resumo !== h.titulo ? (
            <p className="text-small text-muted">{h.resumo}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span
            className="text-heading-sm font-medium tabular-nums"
            aria-label={`Score ${formatNumber(h.score, 0)} de 100`}
          >
            {formatNumber(h.score, 0)}
          </span>
          <span className="text-label uppercase text-muted" aria-hidden="true">
            score
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-8">
        {h.tipoEvento ? (
          <Badge variant="outline">{TIPO_EVENTO[h.tipoEvento] ?? h.tipoEvento}</Badge>
        ) : null}
        {h.materialidade ? (
          <Badge variant={h.materialidade === "alta" ? "strong" : "default"}>
            {MATERIALIDADE[h.materialidade]}
          </Badge>
        ) : null}
        {h.tickers.map((t) => (
          <Link
            key={t}
            href={`/ativo/${t}`}
            className="rounded-sm border border-default px-6 py-2 font-mono text-small tracking-[0.05em] hover:bg-surface-3"
          >
            {t}
          </Link>
        ))}
        <SentimentoTexto valor={h.sentimento} />
        <span className="text-small text-muted">
          {h.nFontes} {h.nFontes === 1 ? "fonte" : "fontes"} ·{" "}
          <time dateTime={h.ultimaEm}>{formatDateTimeBr(h.ultimaEm)}</time>
        </span>
      </div>

      {compacto ? null : (
        <details className="group rounded-md border border-default">
          <summary className="cursor-pointer list-none px-12 py-8 text-small text-muted hover:text-primary">
            <span
              aria-hidden="true"
              className="mr-4 inline-block transition-transform group-open:rotate-90"
            >
              ›
            </span>
            Por que é relevante · {h.itens.length} {h.itens.length === 1 ? "item" : "itens"}
          </summary>
          <div className="grid gap-16 px-12 pb-12 lg:grid-cols-2">
            <ScoreBreakdown historia={h} />
            <ul className="flex flex-col gap-6 text-small">
              {h.itens.map((i) => (
                <li key={`${i.link}-${i.publicadoEm}`} className="flex flex-col">
                  <a
                    href={i.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline"
                  >
                    {i.titulo}
                    <span className="sr-only"> (abre em nova aba)</span>
                  </a>
                  <span className="text-muted">
                    {i.fonte} · {formatDateTimeBr(i.publicadoEm)}
                    {i.sentimento ? ` · ${i.sentimento}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </article>
  );
}
