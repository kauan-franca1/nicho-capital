import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/** Skeleton em vez de spinner (prompt §7). Pulso de opacidade, respeitando reduced-motion. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-3 motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
