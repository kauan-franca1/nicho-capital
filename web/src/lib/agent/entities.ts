import { universe } from "@/lib/universe";

/** Resolução de entidades citadas pelo usuário: ticker, empresa, setor e fatores conhecidos. */

export const semAcento = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Sinônimos de setor em linguagem de mercado → chave de setor do universo. */
const SINONIMOS_SETOR: [RegExp, string][] = [
  [/\b(banco|bancos|bancario|financeir|seguradora)/, "financeiro"],
  [/\b(varejo|varejistas?|consumo)/, "consumo"],
  [/\b(minera|siderur|aco\b|metalurg)/, "mineracao_siderurgia"],
  [/\b(petrol|oleo e gas|combustiv)/, "petroleo_gas"],
  [/\b(eletric|energia|saneamento|utilities)/, "utilidades"],
  [/\b(saude|hospita|farmac)/, "saude"],
  [/\b(papel|celulose)/, "papel_celulose"],
  [/\b(industria|bens de capital)/, "industria"],
  [/\b(logistic|transporte|ferrovi|rodovi|locadora)/, "transporte_logistica"],
  [/\b(telecom|tecnologia|telefonia)/, "telecom_tecnologia"],
  [/\b(imobiliari|construtora|incorporadora)/, "imobiliario"],
];

/** Fatores fora do universo, aproximados pela empresa ou setor mais exposto (documentado). */
const FATORES: [RegExp, { no: string; nota: string }][] = [
  [/\bminerio/, { no: "empresa:VALE3", nota: "minério de ferro aproximado pela Vale (VALE3)" }],
  [
    /\b(petroleo|brent)/,
    { no: "empresa:PETR4", nota: "petróleo aproximado pela Petrobras (PETR4)" },
  ],
  [/\b(celulose)/, { no: "empresa:SUZB3", nota: "celulose aproximada pela Suzano (SUZB3)" }],
  [/\b(juros|selic)/, { no: "setor:financeiro", nota: "juros aproximados pelo setor financeiro" }],
];

export function resolverTicker(texto: string): string | null {
  const t = texto.toUpperCase().match(/\b([A-Z][A-Z0-9]{3}\d{1,2})\b/)?.[1];
  if (t && universe.ativos.some((a) => a.ticker === t)) return t;
  const alvo = semAcento(texto);
  // Nomes mais longos primeiro: "Itaú Unibanco" antes de "Itaú".
  const candidatos = universe.ativos
    .flatMap((a) => [a.nome, ...(a.apelidos ?? [])].map((n) => ({ t: a.ticker, n: semAcento(n) })))
    .sort((a, b) => b.n.length - a.n.length);
  for (const c of candidatos) {
    if (
      c.n.length >= 3 &&
      new RegExp(`(^|[^a-z0-9])${c.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(
        alvo,
      )
    ) {
      return c.t;
    }
  }
  return null;
}

export function resolverSetor(texto: string): string | null {
  const alvo = semAcento(texto);
  for (const [k, nome] of Object.entries(universe.setores)) {
    if (alvo.includes(semAcento(nome))) return k;
  }
  return SINONIMOS_SETOR.find(([re]) => re.test(alvo))?.[1] ?? null;
}

/** Nó do grafo para propagação de choque: empresa, setor, fator conhecido ou acionista. */
export function resolverNo(
  texto: string,
  sementes: { id: string; rotulo: string }[] = [],
): { id: string; nota: string | null } | null {
  const alvo = semAcento(texto);
  const fator = FATORES.find(([re]) => re.test(alvo));
  const ticker = resolverTicker(texto);
  if (ticker) return { id: `empresa:${ticker}`, nota: null };
  if (fator) return { id: fator[1].no, nota: fator[1].nota };
  const setor = resolverSetor(texto);
  if (setor) return { id: `setor:${setor}`, nota: null };
  const acionista = sementes.find(
    (s) => s.id.startsWith("acionista:") && alvo.includes(semAcento(s.rotulo).split(/[ ,]/)[0]),
  );
  return acionista ? { id: acionista.id, nota: null } : null;
}

export function nomeDoTicker(t: string): string {
  return universe.ativos.find((a) => a.ticker === t)?.nome ?? t;
}
