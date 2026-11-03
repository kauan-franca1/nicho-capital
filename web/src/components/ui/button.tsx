import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

// Identidade: o ghost é a voz padrão; o inverso (fundo claro) é raro.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-8 rounded-md text-body font-medium " +
    "transition-colors duration-(--duration-fast) ease-standard " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "border border-primary bg-transparent text-primary hover:bg-surface-3",
        inverse: "border border-primary bg-primary text-surface-1 hover:bg-max",
        link: "px-0 py-0 text-link underline-offset-4 hover:underline",
      },
      size: {
        md: "px-16 py-8",
        sm: "px-12 py-4 text-data",
      },
    },
    compoundVariants: [{ variant: "link", className: "px-0 py-0" }],
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
