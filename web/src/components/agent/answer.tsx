import { Fragment, type ReactNode } from "react";

import type { Fonte } from "@/lib/agent/tools";

/**
 * Renderização segura (só elementos React, nunca HTML cru) do texto do agente:
 * parágrafos, listas "- ", **negrito** e citações [n] que viram links para a fonte.
 */

function inline(texto: string, fontes: Map<number, Fonte>, chave: string): ReactNode[] {
  const partes = texto.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return partes.map((p, i) => {
    const k = `${chave}-${i}`;
    const negrito = p.match(/^\*\*([^*]+)\*\*$/);
    if (negrito)
      return (
        <strong key={k} className="font-semibold">
          {negrito[1]}
        </strong>
      );
    const cit = p.match(/^\[(\d+)\]$/);
    if (cit) {
      const f = fontes.get(Number(cit[1]));
      return f ? (
        <sup key={k}>
          <a
            href={f.link}
            target="_blank"
            rel="noopener noreferrer"
            title={`${f.origem}: ${f.titulo}`}
            className="px-1 text-link hover:underline"
          >
            [{f.n}]
            <span className="sr-only">
              {" "}
              {f.origem}: {f.titulo} (abre em nova aba)
            </span>
          </a>
        </sup>
      ) : (
        <sup key={k} className="text-muted">
          {p}
        </sup>
      );
    }
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export function Answer({ texto, fontes }: { texto: string; fontes: Fonte[] }) {
  const mapa = new Map(fontes.map((f) => [f.n, f]));
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = (k: number) => {
    if (!lista.length) return;
    blocos.push(
      <ul key={`ul-${k}`} className="ml-16 flex list-disc flex-col gap-4 marker:text-muted">
        {lista.map((l, i) => (
          <li key={i}>{inline(l, mapa, `li-${k}-${i}`)}</li>
        ))}
      </ul>,
    );
    lista = [];
  };
  texto.split("\n").forEach((linha, k) => {
    const item = linha.match(/^\s*[-*•]\s+(.*)$/);
    if (item) {
      lista.push(item[1]);
      return;
    }
    fecharLista(k);
    if (linha.trim()) blocos.push(<p key={`p-${k}`}>{inline(linha, mapa, `p-${k}`)}</p>);
  });
  fecharLista(-1);
  return <div className="flex flex-col gap-8 text-body leading-relaxed">{blocos}</div>;
}
