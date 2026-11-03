"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

// O Sigma usa WebGL e `window` ao ser importado: só no navegador.
export const GraphExplorerLazy = dynamic(
  () => import("./graph-explorer").then((m) => m.GraphExplorer),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-label="Carregando grafos" className="flex flex-col gap-12">
        <Skeleton className="h-32 w-1/3" />
        <Skeleton className="h-[520px]" />
      </div>
    ),
  },
);
