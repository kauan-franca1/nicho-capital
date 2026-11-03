import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

// Identidade: fundo #1f1f1f, borda #323232, foco com anel azul. Placeholder em Fog (C4).
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-(--color-iron-peak) bg-surface-2 p-12 text-body text-primary",
        "placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus",
        className,
      )}
      {...props}
    />
  );
}
