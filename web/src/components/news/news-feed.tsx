"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import type { Historia } from "@/lib/data/types";

import { classeSentimento, TIPO_EVENTO, type ClasseSentimento } from "./labels";

export type Filtros = {
  setor: string;
  tipo: string;
  sentimento: "" | ClasseSentimento;
  minimo: number;
};

/** Só o que o filtro precisa: é o que vai para o navegador (o card já vem pronto do servidor). */
export type HistoriaFiltro = Pick<
  Historia,
  "id" | "tickers" | "tipoEvento" | "sentimento" | "score"
>;

export const POR_PAGINA = 30;

export const FILTROS_PADRAO: Filtros = { setor: "", tipo: "", sentimento: "", minimo: 0 };

/** Filtro puro (testável): setor via tickers do universo, tipo de evento, sentimento e score. */
export function filtrar<H extends HistoriaFiltro>(
  historias: H[],
  f: Filtros,
  setorDoTicker: Record<string, string>,
): H[] {
  return historias.filter(
    (h) =>
      (!f.setor || h.tickers.some((t) => setorDoTicker[t] === f.setor)) &&
      (!f.tipo || h.tipoEvento === f.tipo) &&
      (!f.sentimento || classeSentimento(h.sentimento) === f.sentimento) &&
      h.score >= f.minimo,
  );
}

function Campo({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <label htmlFor={id} className="text-label font-medium uppercase text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const SELECT =
  "w-full rounded-md border border-(--color-iron-peak) bg-surface-2 px-8 py-6 text-small text-primary";

/**
 * Feed de histórias com filtros. Os cards vêm prontos do servidor (`cards`, na mesma ordem de
 * `historias`); aqui só se decide quais mostrar.
 */
export function NewsFeed({
  historias,
  cards,
  setores,
  setorDoTicker,
}: {
  historias: HistoriaFiltro[];
  cards: ReactNode[];
  setores: Record<string, string>;
  setorDoTicker: Record<string, string>;
}) {
  const [f, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  const [limite, setLimite] = useState(POR_PAGINA);
  // Mudar o filtro volta para a primeira página.
  const setF = (novo: Filtros) => {
    setFiltros(novo);
    setLimite(POR_PAGINA);
  };
  const filtradas = useMemo(
    () => filtrar(historias, f, setorDoTicker),
    [historias, f, setorDoTicker],
  );
  const visiveis = useMemo(
    () => new Set(filtradas.slice(0, limite).map((h) => h.id)),
    [filtradas, limite],
  );
  const tipos = useMemo(
    () => [...new Set(historias.map((h) => h.tipoEvento).filter((t): t is string => !!t))].sort(),
    [historias],
  );

  return (
    <div className="flex flex-col gap-16">
      <form
        role="search"
        aria-label="Filtrar histórias"
        className="grid grid-cols-2 gap-12 rounded-lg border border-default bg-surface-2 p-12 md:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <Campo label="Setor">
          {(id) => (
            <select
              id={id}
              className={SELECT}
              value={f.setor}
              onChange={(e) => setF({ ...f, setor: e.target.value })}
            >
              <option value="">Todos</option>
              {Object.entries(setores).map(([k, nome]) => (
                <option key={k} value={k}>
                  {nome}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo label="Tipo de evento">
          {(id) => (
            <select
              id={id}
              className={SELECT}
              value={f.tipo}
              onChange={(e) => setF({ ...f, tipo: e.target.value })}
            >
              <option value="">Todos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {TIPO_EVENTO[t] ?? t}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo label="Sentimento">
          {(id) => (
            <select
              id={id}
              className={SELECT}
              value={f.sentimento}
              onChange={(e) => setF({ ...f, sentimento: e.target.value as Filtros["sentimento"] })}
            >
              <option value="">Todos</option>
              <option value="positivo">+ Positivo</option>
              <option value="neutro">· Neutro</option>
              <option value="negativo">− Negativo</option>
            </select>
          )}
        </Campo>
        <Campo label={`Relevância mínima: ${f.minimo}`}>
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={90}
              step={5}
              value={f.minimo}
              onChange={(e) => setF({ ...f, minimo: Number(e.target.value) })}
              className="mt-8 w-full accent-(--color-bone)"
            />
          )}
        </Campo>
      </form>

      <p role="status" className="text-small text-muted">
        {filtradas.length} de {historias.length} histórias
        {filtradas.length > visiveis.size ? ` (mostrando ${visiveis.size})` : ""}
      </p>

      {visiveis.size === 0 ? (
        <EmptyState title="Nenhuma história com esses filtros">
          Diminua a relevância mínima ou escolha outro setor.
        </EmptyState>
      ) : (
        <section
          aria-labelledby="lista-historias"
          className="rounded-lg border border-default bg-surface-2 p-(--card-padding)"
        >
          <h2 id="lista-historias" className="sr-only">
            Histórias
          </h2>
          {historias.map((h, i) =>
            visiveis.has(h.id) ? <Fragment key={h.id}>{cards[i]}</Fragment> : null,
          )}
        </section>
      )}
      {filtradas.length > visiveis.size ? (
        <div className="flex justify-center">
          <Button type="button" onClick={() => setLimite((l) => l + POR_PAGINA)}>
            Mostrar mais {Math.min(POR_PAGINA, filtradas.length - visiveis.size)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
