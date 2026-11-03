import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

// Identidade + C12: status nunca por matiz — só por borda, peso e tracking.
const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-10 py-4 text-label font-medium uppercase text-primary",
  {
    variants: {
      variant: {
        default: "bg-surface-4 border border-subtle",
        strong: "bg-surface-4 border-2 border-primary font-semibold",
        dashed: "bg-surface-4 border border-dashed border-primary",
        outline: "bg-transparent border border-strong",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
