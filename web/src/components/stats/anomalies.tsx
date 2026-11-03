import Link from "next/link";

import { Delta } from "@/components/delta";
import { Badge } from "@/components/ui/badge";
import type { Anomalia, Severidade } from "@/lib/data/types";
import { formatDateBr, formatNumber } from "@/lib/format";

// C12: severidade por borda e peso, nunca por cor.
const VARIANTE: Record<Severidade, "strong" | "default" | "outline"> = {
  alta: "strong",
  media: "default",
  baixa: "outline",
};
const ROTULO_SEV: Record<Severidade, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export function SeverityBadge({ severidade }: { severidade: Severidade }) {
  return (
    <Badge variant={VARIANTE[severidade]}>
      <span className="sr-only">Severidade </span>
      {ROTULO_SEV[severidade]}
    </Badge>
  );
}

export const ROTULO_METODO: Record<Anomalia["metodo"], string> = {
  robust_z_retorno: "Retorno",
  robust_z_volume: "Volume",
  change_point: "Mudança de regime",
};

const pct = (v: unknown) => `${formatNumber(Number(v) * 100, 0)}%`;

/** Descrição curta e explicável de cada anomalia. */
export function AnomaliaDescricao({ a }: { a: Anomalia }) {
  switch (a.metodo) {
    case "robust_z_retorno":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-8">
          <Delta value={Number(a.detalhes.retorno)} />
          <span className="text-small text-muted tabular-nums">z = {formatNumber(a.valor, 1)}</span>
        </span>
      );
    case "robust_z_volume":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-8">
          <span className="tabular-nums">
            {formatNumber(Number(a.detalhes.multiplo), 1)}× o volume mediano
          </span>
          <span className="text-small text-muted tabular-nums">z = {formatNumber(a.valor, 1)}</span>
        </span>
      );
    case "change_point":
      return (
        <span className="tabular-nums">
          Volatilidade {a.detalhes.direcao === "alta" ? "subiu" : "caiu"} de{" "}
          {pct(a.detalhes.vol_antes_anual)} para {pct(a.detalhes.vol_depois_anual)} a.a.
        </span>
      );
  }
}

/** Tabela de anomalias. `comTicker` para listas do universo (home). */
export function AnomaliaTable({
  anomalias,
  comTicker = false,
  caption,
}: {
  anomalias: Anomalia[];
  comTicker?: boolean;
  caption: string;
}) {
  return (
    <table className="w-full text-data">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-default text-left text-label font-medium uppercase text-muted">
          {comTicker ? (
            <th scope="col" className="py-6 pr-8 font-medium">
              Ativo
            </th>
          ) : (
            <th scope="col" className="py-6 pr-8 font-medium">
              Dia
            </th>
          )}
          <th scope="col" className="py-6 pr-8 font-medium">
            Tipo
          </th>
          <th scope="col" className="py-6 pr-8 font-medium">
            O que aconteceu
          </th>
          <th scope="col" className="py-6 text-right font-medium">
            Severidade
          </th>
        </tr>
      </thead>
      <tbody>
        {anomalias.map((a) => (
          <tr
            key={`${a.ticker}-${a.dia}-${a.metodo}`}
            className="border-b border-default last:border-0"
          >
            <th scope="row" className="py-8 pr-8 text-left font-normal">
              {comTicker ? (
                <Link
                  href={`/ativo/${a.ticker}`}
                  className="inline-block py-4 font-mono tracking-[0.05em] text-primary hover:underline"
                >
                  {a.ticker}
                </Link>
              ) : (
                <span className="tabular-nums">{formatDateBr(a.dia)}</span>
              )}
            </th>
            <td className="py-8 pr-8 text-muted">{ROTULO_METODO[a.metodo]}</td>
            <td className="py-8 pr-8">
              <AnomaliaDescricao a={a} />
            </td>
            <td className="py-8 text-right">
              <SeverityBadge severidade={a.severidade} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ORDEM: Record<Severidade, number> = { alta: 3, media: 2, baixa: 1 };

/** Anomalias de um dia, ordenadas por severidade e intensidade. Índice fica de fora. */
export function anomaliasDoDia(todas: Anomalia[], dia: string | null, limite = 8): Anomalia[] {
  return todas
    .filter((a) => a.dia === dia && !a.ticker.startsWith("^"))
    .sort(
      (x, y) => ORDEM[y.severidade] - ORDEM[x.severidade] || Math.abs(y.valor) - Math.abs(x.valor),
    )
    .slice(0, limite);
}
