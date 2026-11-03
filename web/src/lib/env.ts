/** Modo demo: o site lê o snapshot em demo/ e não precisa de banco, internet nem chaves (ADR 0002). */
export function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}
