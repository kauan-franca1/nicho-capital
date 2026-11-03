import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-12">
      <Skeleton className="h-40 w-1/2" />
      <Skeleton className="h-16 w-3/4" />
      <div className="mt-24 grid gap-12 md:grid-cols-3">
        <Skeleton className="h-160" />
        <Skeleton className="h-160" />
        <Skeleton className="h-160" />
      </div>
    </div>
  );
}
