"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="ghost" data-print="hide" onClick={() => window.print()}>
      Imprimir ou salvar em PDF
    </Button>
  );
}
