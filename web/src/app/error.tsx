"use client";

import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Algo deu errado ao montar esta página"
      action={
        <Button size="sm" onClick={reset}>
          Tentar de novo
        </Button>
      }
    >
      O restante do site continua funcionando. Se o problema persistir, veja a página de status.
    </ErrorState>
  );
}
