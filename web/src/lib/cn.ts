import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// O tailwind-merge precisa conhecer a escala tipográfica customizada (tokens.css);
// sem isso, `text-body` e `text-muted` seriam tratados como o mesmo grupo e um apagaria o outro.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption",
            "label",
            "small",
            "data",
            "body",
            "lead",
            "heading-sm",
            "heading",
            "heading-lg",
            "section",
            "display",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
