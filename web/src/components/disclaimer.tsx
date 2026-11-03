/** Disclaimer fixo e discreto em todo o produto (prompt §7 e §10). */
export function Disclaimer() {
  return (
    <div
      role="note"
      className="fixed inset-x-0 bottom-0 z-40 flex h-(--disclaimer-height) items-center justify-center border-t border-default bg-surface-0 px-16 print:static print:h-auto print:py-8"
    >
      {/* Nunca truncar: é texto legal. No celular quebra em duas linhas (altura no tokens.css). */}
      <p className="text-center text-label tracking-normal text-muted sm:text-small">
        Ferramenta educacional. Não constitui recomendação de investimento. Dados públicos com
        atraso.
      </p>
    </div>
  );
}
