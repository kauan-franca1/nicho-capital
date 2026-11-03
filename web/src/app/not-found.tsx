import Link from "next/link";

import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      title="Página não encontrada"
      action={
        <Link href="/" className={buttonVariants({ size: "sm" })}>
          Voltar ao mercado
        </Link>
      }
    >
      Se você digitou um ticker, ele pode não fazer parte do universo monitorado.
    </EmptyState>
  );
}
