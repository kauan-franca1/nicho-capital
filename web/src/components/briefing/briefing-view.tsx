import type { Briefing } from "@/lib/data/types";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";

/** Link de fonte: externo abre em nova aba; interno (/ativo/...) navega no app. */
function LinkFonte({ href, children }: { href: string; children: React.ReactNode }) {
  const externo = /^https?:/.test(href);
  return (
    <a
      href={href}
      className="text-link hover:underline"
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
      {externo ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </a>
  );
}

export function BriefingView({ b, compacto = false }: { b: Briefing; compacto?: boolean }) {
  const fontes = new Map(b.fontes.map((f) => [f.n, f]));
  return (
    <article className="flex flex-col gap-24">
      {compacto ? null : (
        <header className="flex flex-col gap-4">
          <p className="text-label uppercase text-muted">Briefing do pregão de</p>
          <h2 className="font-serif text-heading-lg font-normal text-primary">
            {formatDateBr(b.dia)}
          </h2>
          <p className="text-small text-muted">
            Versão {b.versao} · gerado em {formatDateTimeBr(b.geradoEm)} · método:{" "}
            {b.metodo === "regras" ? "regras sobre os dados do banco (sem LLM)" : b.metodo}
          </p>
        </header>
      )}

      {b.secoes.map((s) => (
        <section key={s.id} aria-labelledby={`${b.dia}-${s.id}`} className="flex flex-col gap-8">
          <h3
            id={`${b.dia}-${s.id}`}
            className="border-b border-default pb-4 text-label font-medium uppercase text-muted"
          >
            {s.titulo}
          </h3>
          <ul className="flex flex-col gap-6 text-body leading-relaxed">
            {s.itens.map((item, i) => (
              <li key={i}>
                {item.texto}
                {item.refs.map((n) => {
                  const f = fontes.get(n);
                  return f ? (
                    <sup key={n} className="px-1">
                      <LinkFonte href={f.link}>[{n}]</LinkFonte>
                    </sup>
                  ) : null;
                })}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby={`${b.dia}-fontes`} className="flex flex-col gap-8">
        <h3
          id={`${b.dia}-fontes`}
          className="border-b border-default pb-4 text-label font-medium uppercase text-muted"
        >
          Fontes
        </h3>
        <ol className="flex flex-col gap-6 text-small">
          {b.fontes.map((f) => (
            <li key={f.n} className="flex min-w-0 gap-8">
              <span className="shrink-0 tabular-nums text-muted">[{f.n}]</span>
              <span className="flex min-w-0 flex-col">
                <span className="break-words">
                  <LinkFonte href={f.link}>{f.titulo}</LinkFonte>
                </span>
                <span className="text-muted">
                  {f.origem}
                  {f.data
                    ? ` · ${f.data.length === 10 ? formatDateBr(f.data) : formatDateTimeBr(f.data)}`
                    : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-small text-muted">{b.aviso}</p>
    </article>
  );
}
