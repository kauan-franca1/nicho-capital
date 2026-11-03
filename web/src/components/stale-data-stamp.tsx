import { formatDateTimeBr } from "@/lib/format";

/** Selo obrigatório (prompt §2): os dados do Yahoo têm atraso. */
export function StaleDataStamp({ lastUpdated }: { lastUpdated: string | null }) {
  return (
    <p className="text-small text-muted">
      <span className="font-medium text-primary">Dados com atraso, não é tempo real.</span>{" "}
      {lastUpdated ? (
        <>
          Atualizado em <time dateTime={lastUpdated}>{formatDateTimeBr(lastUpdated)}</time>.
        </>
      ) : (
        <>Ainda sem dados coletados.</>
      )}
    </p>
  );
}
