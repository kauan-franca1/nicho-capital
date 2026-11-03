import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type StateProps = { title: string; children?: ReactNode; action?: ReactNode; className?: string };

/** Estado vazio: diz o que falta e o que fazer, sem ilustração genérica. */
export function EmptyState({ title, children, action, className }: StateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-8 rounded-lg border border-dashed border-strong p-24",
        className,
      )}
    >
      <p className="text-body font-medium text-primary">{title}</p>
      {children ? <div className="text-body text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

/** Estado de erro: borda forte de 2 px em vez de vermelho (C12). */
export function ErrorState({ title, children, action, className }: StateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-8 rounded-lg border-2 border-primary p-24",
        className,
      )}
    >
      <p className="text-body font-semibold text-primary">{title}</p>
      {children ? <div className="text-body text-muted">{children}</div> : null}
      {action}
    </div>
  );
}
