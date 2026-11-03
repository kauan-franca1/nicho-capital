"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

// Gráficos abaixo da dobra carregam sob demanda: tiram Recharts do caminho crítico da página do
// ativo (Lighthouse: TBT). O esqueleto tem a mesma altura do gráfico, para não haver CLS.

export const CarChartLazy = dynamic(() => import("./car-chart").then((m) => m.CarChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px]" />,
});

export const VolChartLazy = dynamic(() => import("./vol-chart").then((m) => m.VolChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px]" />,
});
