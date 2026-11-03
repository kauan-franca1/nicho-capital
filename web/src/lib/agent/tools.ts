import {
  getAssetStats,
  getDaily,
  getGrafos,
  getHistorias,
  getMacro,
  getMeta,
  getRecentDaily,
  getVetores,
} from "@/lib/data/source";
import type { DailyBar, Historia } from "@/lib/data/types";
import { formatDateBr, formatNumber } from "@/lib/format";
import { vizinhanca } from "@/lib/graphs";
import { macroSummary } from "@/lib/market";
import { universe } from "@/lib/universe";

import { nomeDoTicker, resolverNo, resolverSetor, resolverTicker } from "./entities";
import { eventStudy } from "./event-study";
import { buscarHistorias } from "./search";

/**
 * Ferramentas do agente (prompt §6). Toda afirmação factual do agente vem daqui: os dados vêm da
 * mesma camada do site (snapshot ou Postgres) e cada notícia ou documento citado ganha um número
 * [n] no registro de fontes, que a interface transforma em link.
 */

export type Fonte = { n: number; titulo: string; link: string; origem: string; data: string };

export class RegistroFontes {
  private porLink = new Map<string, Fonte>();
  adicionar(f: Omit<Fonte, "n">): number {
    const existente = this.porLink.get(f.link);
    if (existente) return existente.n;
    const n = this.porLink.size + 1;
    this.porLink.set(f.link, { ...f, n });
    return n;
  }
  lista(): Fonte[] {
    return [...this.porLink.values()];
  }
}

export type ResultadoFerramenta = { resumo: string; dados: unknown };
type Ferramenta = {
  descricao: string;
  passo: string; // texto mostrado enquanto roda
  parametros: Record<string, unknown>;
  executar: (args: Record<string, unknown>, fontes: RegistroFontes) => Promise<ResultadoFerramenta>;
};

const px = (b: DailyBar) => b.adjClose ?? b.close;
const pct = (x: number) => Math.round(x * 10000) / 100; // fração → % com 2 casas
/** Fração → texto pt-BR com sinal ("+4,29%", "−0,75%"), para as evidências. */
const pctTxt = (x: number) => `${x >= 0 ? "+" : ""}${formatNumber(x * 100, 2)}%`;
const JANELA_DIRECAO = 5; // pregões olhados para "por que caiu/subiu" sem data
const PERIODOS: Record<string, number> = {
  "1d": 1,
  "1s": 5,
  "1m": 21,
  "3m": 63,
  "6m": 126,
  "1a": 252,
  "3a": 756,
};

function ticker(args: Record<string, unknown>): string {
  const t = resolverTicker(String(args.ticker ?? ""));
  if (!t) throw new Error(`ticker não reconhecido no universo: ${String(args.ticker)}`);
  return t;
}

function citarHistoria(h: Historia, fontes: RegistroFontes) {
  const principal = h.itens[0];
  const refs = h.itens
    .slice(0, 3)
    .map((i) =>
      fontes.adicionar({ titulo: i.titulo, link: i.link, origem: i.fonte, data: i.publicadoEm }),
    );
  return {
    ref: refs,
    titulo: h.titulo,
    resumo: h.resumo,
    tickers: h.tickers,
    tipo_evento: h.tipoEvento,
    materialidade: h.materialidade,
    sentimento: h.sentimento,
    score: h.score,
    n_fontes: h.nFontes,
    quando: principal?.publicadoEm ?? h.primeiraEm,
  };
}

async function historiasComVetor() {
  const [hs, v] = await Promise.all([getHistorias(), getVetores()]);
  return { hs: hs.map((h) => ({ ...h, vetor: v.porHistoria[h.id] ?? null })), media: v.media };
}

// ------------------------------------------------------------------ explain_move
export type Hipotese = {
  hipotese: string;
  confianca: "alta" | "media" | "baixa";
  evidencia: string;
};

export async function explicarMovimento(
  t: string,
  data: string | null,
  fontes: RegistroFontes,
  direcao: "queda" | "alta" | null = null,
) {
  const [bars, ibov, recentes, estat, { hs }] = await Promise.all([
    getDaily(t),
    getDaily(universe.indice.ticker),
    getRecentDaily(5),
    getAssetStats(t),
    historiasComVetor(),
  ]);
  let i = data ? bars.findIndex((b) => b.dia >= data) : bars.length - 1;
  if (i < 1) return { erro: "não encontrei pregão para essa data" };
  // "Por que caiu?" sem data: se o último pregão foi no sentido oposto, explica o maior
  // movimento no sentido perguntado dentro da última semana (e avisa).
  let observacao: string | null = null;
  const r = (k: number) => px(bars[k]) / px(bars[k - 1]) - 1;
  if (!data && direcao && Math.sign(r(i)) !== (direcao === "queda" ? -1 : 1)) {
    const ultimo = i;
    for (let k = Math.max(1, ultimo - JANELA_DIRECAO + 1); k <= ultimo; k++) {
      if (direcao === "queda" ? r(k) < r(i) : r(k) > r(i)) i = k;
    }
    if (i !== ultimo && Math.sign(r(i)) === (direcao === "queda" ? -1 : 1)) {
      observacao = `No último pregão (${formatDateBr(bars[ultimo].dia)}) a ação variou ${pctTxt(r(ultimo))}; a maior ${direcao} dos últimos ${JANELA_DIRECAO} pregões foi em ${formatDateBr(bars[i].dia)}.`;
    } else {
      i = ultimo;
      observacao = `Não houve ${direcao} nos últimos ${JANELA_DIRECAO} pregões; explico o último.`;
    }
  }
  const dia = bars[i].dia;
  const ri = px(bars[i]) / px(bars[i - 1]) - 1;
  const j = ibov.findIndex((b) => b.dia === dia);
  const rm = j > 0 ? px(ibov[j]) / px(ibov[j - 1]) - 1 : null;
  const es = eventStudy(bars, ibov, dia, [0, 0]);
  const ar = es ? Math.expm1(es.car) : null;

  const setor = universe.ativos.find((a) => a.ticker === t)?.setor;
  const pares = universe.ativos.filter((a) => a.setor === setor && a.ticker !== t);
  const retornosPares = pares
    .map((a) => {
      const b = recentes[a.ticker] ?? [];
      const k = b.findIndex((x) => x.dia === dia);
      return k > 0 ? { ticker: a.ticker, r: px(b[k]) / px(b[k - 1]) - 1 } : null;
    })
    .filter((x): x is { ticker: string; r: number } => x !== null);
  const rSetor = retornosPares.length
    ? retornosPares.reduce((s, x) => s + x.r, 0) / retornosPares.length
    : null;

  const anomalias = estat.anomalias.filter((a) => a.dia === dia);
  const janelaIni = new Date(Date.parse(`${dia}T00:00:00Z`) - 3 * 864e5).toISOString().slice(0, 10);
  const janelaFim = new Date(Date.parse(`${dia}T00:00:00Z`) + 1 * 864e5).toISOString().slice(0, 10);
  const doDia = (h: Historia) =>
    h.primeiraEm.slice(0, 10) >= janelaIni && h.primeiraEm.slice(0, 10) <= janelaFim;
  const especificas = hs
    .filter((h) => h.tickers.includes(t) && doDia(h))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const mercado = hs
    .filter((h) => doDia(h) && (h.tipoEvento === "macro" || h.tickers.length >= 3))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  // Hipóteses ranqueadas, com regra explícita (documentada na página de metodologia).
  const hipoteses: Hipotese[] = [];
  const significativo = es ? es.pValor < 0.05 : false;
  if (rm !== null && es) {
    const explicado = es.beta * Math.log1p(rm);
    if (!significativo) {
      hipoteses.push({
        hipotese: "Acompanhou o mercado",
        confianca: "alta",
        evidencia: `Ibovespa ${pctTxt(rm)}; com β = ${formatNumber(es.beta, 2)}, o modelo de mercado explica ${pctTxt(Math.expm1(explicado))} e o retorno anormal (${pctTxt(ar ?? 0)}) não é significativo (p = ${formatNumber(es.pValor, 2)}).`,
      });
    } else {
      hipoteses.push({
        hipotese: "Mercado explica só parte do movimento",
        confianca: "media",
        evidencia: `Ibovespa ${pctTxt(rm)}, mas o retorno anormal de ${pctTxt(ar ?? 0)} é significativo (p = ${es.pValor < 0.001 ? "< 0,001" : formatNumber(es.pValor, 3)}).`,
      });
    }
  }
  if (
    rSetor !== null &&
    Math.sign(rSetor) === Math.sign(ri) &&
    Math.abs(rSetor) > 0.4 * Math.abs(ri)
  ) {
    hipoteses.push({
      hipotese: "Movimento do setor",
      confianca: Math.abs(rSetor) > 0.7 * Math.abs(ri) ? "alta" : "media",
      evidencia: `Pares do setor variaram em média ${pctTxt(rSetor)} (${retornosPares.length} ativos).`,
    });
  }
  if (especificas.length) {
    const top = especificas[0];
    hipoteses.push({
      hipotese: "Notícia ou documento da própria empresa",
      confianca: significativo && top.score >= 60 ? "alta" : top.score >= 50 ? "media" : "baixa",
      evidencia: `"${top.titulo}" (score ${Math.round(top.score)}, ${top.nFontes} fonte(s)).`,
    });
  }
  if (mercado.length) {
    hipoteses.push({
      hipotese: "Fato macro ou de mercado no período",
      confianca: "media",
      evidencia: `"${mercado[0].titulo}".`,
    });
  }
  if (significativo && !especificas.length) {
    hipoteses.push({
      hipotese: "Sem explicação nos dados coletados",
      confianca: "baixa",
      evidencia:
        "Há retorno anormal significativo, mas nenhuma notícia ou documento sobre a empresa na janela.",
    });
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  hipoteses.sort((a, b) => ordem[a.confianca] - ordem[b.confianca]);

  return {
    ticker: t,
    empresa: nomeDoTicker(t),
    pregao: dia,
    observacao,
    retorno_pct: pct(ri),
    ibovespa_pct: rm === null ? null : pct(rm),
    retorno_anormal_pct: ar === null ? null : pct(ar),
    beta: es ? Math.round(es.beta * 100) / 100 : null,
    p_valor: es ? es.pValor : null,
    setor: setor ? universe.setores[setor] : null,
    setor_media_pct: rSetor === null ? null : pct(rSetor),
    pares: retornosPares.map((x) => ({ ticker: x.ticker, retorno_pct: pct(x.r) })),
    anomalias: anomalias.map((a) => ({ metodo: a.metodo, severidade: a.severidade, z: a.valor })),
    noticias_da_empresa: especificas.map((h) => citarHistoria(h, fontes)),
    noticias_de_mercado: mercado.map((h) => citarHistoria(h, fontes)),
    hipoteses,
  };
}

// ------------------------------------------------------------------ catálogo
export const FERRAMENTAS: Record<string, Ferramenta> = {
  get_quote: {
    descricao:
      "Última cotação de um ativo do universo: fechamento, variação no dia, volume e data do pregão.",
    passo: "Consultando cotação…",
    parametros: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
    async executar(args) {
      const t = ticker(args);
      const b = await getDaily(t);
      const u = b.at(-1);
      const a = b.at(-2);
      if (!u || !a) return { resumo: `${t}: sem cotação`, dados: { erro: "sem dados" } };
      const r = px(u) / px(a) - 1;
      return {
        resumo: `${t} R$ ${formatNumber(u.close, 2)} (${pctTxt(r)}) em ${formatDateBr(u.dia)}`,
        dados: {
          ticker: t,
          empresa: nomeDoTicker(t),
          pregao: u.dia,
          fechamento: u.close,
          variacao_pct: pct(r),
          volume: u.volume,
          aviso: "dados com atraso, não é tempo real",
        },
      };
    },
  },
  get_history: {
    descricao:
      "Histórico de preço de um ativo: retorno, máxima, mínima e pontos semanais no período (1d, 1s = semana, 1m, 3m, 6m, 1a, 3a).",
    passo: "Lendo histórico de preços…",
    parametros: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        periodo: { type: "string", enum: Object.keys(PERIODOS) },
      },
      required: ["ticker"],
    },
    async executar(args) {
      const t = ticker(args);
      const n = PERIODOS[String(args.periodo ?? "3m")] ?? 63;
      const b = (await getDaily(t)).slice(-(n + 1));
      if (b.length < 2) return { resumo: `${t}: sem histórico`, dados: { erro: "sem dados" } };
      const r = px(b.at(-1)!) / px(b[0]) - 1;
      return {
        resumo: `${t}: ${pctTxt(r)} em ${b.length - 1} pregões`,
        dados: {
          ticker: t,
          inicio: b[0].dia,
          fim: b.at(-1)!.dia,
          retorno_pct: pct(r),
          maxima: Math.max(...b.map((x) => x.close)),
          minima: Math.min(...b.map((x) => x.close)),
          semanal: b
            .filter((_, i) => i % 5 === 0 || i === b.length - 1)
            .map((x) => [x.dia, x.close]),
        },
      };
    },
  },
  search_news: {
    descricao:
      "Busca histórias de notícias e fatos relevantes (deduplicadas, com score de relevância). Filtros opcionais por ticker e data mínima (AAAA-MM-DD).",
    passo: "Consultando notícias…",
    parametros: {
      type: "object",
      properties: {
        query: { type: "string" },
        ticker: { type: "string" },
        desde: { type: "string" },
      },
      required: ["query"],
    },
    async executar(args, fontes) {
      const { hs, media } = await historiasComVetor();
      const t = args.ticker ? resolverTicker(String(args.ticker)) : null;
      const r = await buscarHistorias(hs, String(args.query ?? ""), {
        ticker: t,
        desde: args.desde ? String(args.desde) : null,
        media,
      });
      return {
        resumo: `${r.historias.length} histórias (busca ${r.metodo === "semantica" ? "semântica" : "lexical"})`,
        dados: {
          metodo_busca: r.metodo,
          historias: r.historias.map((h) => citarHistoria(h, fontes)),
        },
      };
    },
  },
  get_filings: {
    descricao:
      "Fatos relevantes e comunicados ao mercado (CVM) de um ativo, opcionalmente desde uma data.",
    passo: "Consultando documentos da CVM…",
    parametros: {
      type: "object",
      properties: { ticker: { type: "string" }, desde: { type: "string" } },
      required: ["ticker"],
    },
    async executar(args, fontes) {
      const t = ticker(args);
      const desde = args.desde ? String(args.desde) : "";
      const hs = (await getHistorias()).filter(
        (h) => h.tickers.includes(t) && h.itens.some((i) => i.tipo === "cvm"),
      );
      const docs = hs
        .flatMap((h) => h.itens.filter((i) => i.tipo === "cvm"))
        .filter((i) => i.publicadoEm >= desde)
        .sort((a, b) => b.publicadoEm.localeCompare(a.publicadoEm))
        .slice(0, 8)
        .map((i) => ({
          ref: fontes.adicionar({
            titulo: i.titulo,
            link: i.link,
            origem: "CVM",
            data: i.publicadoEm,
          }),
          titulo: i.titulo,
          data: i.publicadoEm.slice(0, 10),
        }));
      return {
        resumo: `${docs.length} documentos da CVM`,
        dados: {
          ticker: t,
          documentos: docs,
          aviso: "o índice IPE da CVM é atualizado semanalmente",
        },
      };
    },
  },
  run_event_study: {
    descricao:
      "Event study (modelo de mercado contra o Ibovespa): retorno anormal acumulado em [-1,+1] e [0,+5] em torno de uma data (AAAA-MM-DD), com teste t e intervalo de 95%.",
    passo: "Calculando retorno anormal…",
    parametros: {
      type: "object",
      properties: { ticker: { type: "string" }, data_evento: { type: "string" } },
      required: ["ticker", "data_evento"],
    },
    async executar(args) {
      const t = ticker(args);
      const [b, m] = await Promise.all([getDaily(t), getDaily(universe.indice.ticker)]);
      const data = String(args.data_evento);
      const janelas = (
        [
          [-1, 1],
          [0, 5],
        ] as [number, number][]
      ).map((j) => {
        const r = eventStudy(b, m, data, j);
        return r
          ? {
              janela: `[${j[0]},+${j[1]}]`,
              car_pct: pct(Math.expm1(r.car)),
              t: Math.round(r.tStat * 100) / 100,
              p_valor: r.pValor,
              ic95_pct: [pct(Math.expm1(r.icInf)), pct(Math.expm1(r.icSup))],
              beta: Math.round(r.beta * 100) / 100,
              n_estimacao: r.nEstimacao,
              data_evento: r.dataEvento,
            }
          : {
              janela: `[${j[0]},+${j[1]}]`,
              erro: "sem histórico suficiente ou janela ainda não terminou",
            };
      });
      return {
        resumo: `${t}: event study em ${formatDateBr(data)}`,
        dados: { ticker: t, resultados: janelas },
      };
    },
  },
  query_graph: {
    descricao:
      "Vizinhos de um ativo nos grafos: ligações na árvore de correlação (ρ), comunidade, controladores, acionistas relevantes e administradores.",
    passo: "Consultando o grafo…",
    parametros: { type: "object", properties: { no: { type: "string" } }, required: ["no"] },
    async executar(args) {
      const t = resolverTicker(String(args.no ?? ""));
      if (!t)
        return {
          resumo: "nó não reconhecido",
          dados: { erro: "use um ticker ou nome de empresa do universo" },
        };
      const v = vizinhanca(await getGrafos(), t);
      return {
        resumo: `${t}: ${v.mst.length} vizinhos, ${v.ligacoes.length} ligações societárias`,
        dados: { ticker: t, ...v, choque: undefined },
      };
    },
  },
  shock_propagation: {
    descricao:
      "Propagação de choque: empresas mais expostas a um choque numa empresa, setor, acionista ou fator (ex.: minério, petróleo, juros), com o caminho que explica cada exposição.",
    passo: "Propagando o choque no grafo…",
    parametros: { type: "object", properties: { no: { type: "string" } }, required: ["no"] },
    async executar(args) {
      const g = await getGrafos();
      const r = resolverNo(String(args.no ?? ""), g.choque?.sementes ?? []);
      const ranking = r ? (g.choque?.rankings[r.id] ?? []) : [];
      if (!r || !ranking.length)
        return { resumo: "sem ranking para esse nó", dados: { erro: "nó não reconhecido" } };
      return {
        resumo: `choque em ${r.id}: ${ranking.length} empresas`,
        dados: {
          origem: r.id,
          observacao: r.nota,
          ressalva: "mede exposição por conexão, não prevê preço",
          ranking: ranking.slice(0, 10).map((x) => ({
            empresa: x.rotulo,
            impacto: x.impacto,
            caminho: x.caminho
              .map((p) => `${p.de} → ${p.motivo}${p.detalhe ? ` (${p.detalhe})` : ""} → ${p.para}`)
              .join("; "),
          })),
        },
      };
    },
  },
  get_macro: {
    descricao:
      "Indicadores do Banco Central (SGS): Selic meta, IPCA mensal e 12 meses, dólar PTAX.",
    passo: "Consultando dados do Banco Central…",
    parametros: {
      type: "object",
      properties: { serie: { type: "string", enum: ["selic", "ipca", "ptax", "todas"] } },
    },
    async executar(_args, fontes) {
      const m = macroSummary(await getMacro());
      const ref = fontes.adicionar({
        titulo: "Sistema Gerenciador de Séries Temporais (Selic 432, IPCA 433, PTAX 1)",
        link: "https://www3.bcb.gov.br/sgspub/",
        origem: "Banco Central do Brasil",
        data: m.ptax?.dia ?? m.selic?.dia ?? "",
      });
      return {
        resumo: "Selic, IPCA e PTAX",
        dados: { ...m, fonte: "Banco Central do Brasil (SGS)", ref: [ref] },
      };
    },
  },
  get_briefing: {
    descricao: "Briefing diário (o que um assessor precisa saber antes das 10h).",
    passo: "Buscando o briefing…",
    parametros: { type: "object", properties: { data: { type: "string" } } },
    async executar() {
      return {
        resumo: "briefing indisponível",
        dados: { erro: "o briefing diário entra na fase 7 do projeto" },
      };
    },
  },
  explain_move: {
    descricao:
      "Explica o movimento de um ativo num pregão: retorno, Ibovespa, retorno anormal (β), setor, anomalias, notícias e fatos relevantes na janela, com hipóteses ranqueadas e confiança. Use para perguntas 'por que X subiu/caiu'.",
    passo: "Calculando retorno anormal e cruzando com notícias…",
    parametros: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD; omita para o último pregão" },
        direcao: {
          type: "string",
          enum: ["queda", "alta"],
          description:
            "Sentido perguntado ('caiu' → queda). Sem data, escolhe o maior movimento nesse sentido na última semana.",
        },
      },
      required: ["ticker"],
    },
    async executar(args, fontes) {
      const t = ticker(args);
      const dir = args.direcao === "queda" || args.direcao === "alta" ? args.direcao : null;
      const r = await explicarMovimento(t, args.data ? String(args.data) : null, fontes, dir);
      return {
        resumo:
          "erro" in r
            ? String(r.erro)
            : `${t}: ${pctTxt(r.retorno_pct / 100)} em ${formatDateBr(r.pregao)}`,
        dados: r,
      };
    },
  },
};

export function esquemasOpenAI() {
  return Object.entries(FERRAMENTAS).map(([nome, f]) => ({
    type: "function" as const,
    function: { name: nome, description: f.descricao, parameters: f.parametros },
  }));
}

export async function ultimoPregao(): Promise<string | null> {
  return (await getMeta()).ultimoPregao;
}

export { resolverSetor };
