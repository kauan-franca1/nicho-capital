import type { ReactNode } from "react";

/** Abertura de página: serif 400 (nunca bold), subtítulo em Inter/Fog (decisão C10). */
export function PageHeader({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-32 flex flex-col gap-12 border-b border-default pb-24 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-8">
        <h1 className="font-serif text-heading font-normal text-primary md:text-heading-lg">
          {title}
        </h1>
        {subtitle ? <p className="max-w-[640px] text-lead text-muted">{subtitle}</p> : null}
      </div>
      {aside}
    </header>
  );
}
