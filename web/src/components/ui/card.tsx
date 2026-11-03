import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        // min-w-0: dentro de grid/flex, deixa o card encolher abaixo da largura dos gráficos
        // (canvas com largura fixa em px), em vez de estourar a página na horizontal.
        "min-w-0 rounded-lg border border-default bg-surface-2 p-(--card-padding) shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mb-12 flex flex-wrap items-baseline justify-between gap-8", className)}
      {...props}
    />
  );
}

/** Título de card: Inter 11 px uppercase, como o header de tabela da identidade. */
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-label font-medium uppercase text-muted", className)} {...props} />;
}
