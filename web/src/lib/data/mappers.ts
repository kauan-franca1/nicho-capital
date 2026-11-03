import type {
  Briefing,
  Execucao,
  Anomalia,
  ComponenteScore,
  EventStudy,
  GarchInfo,
  Grafos,
  Historia,
  HistoriaItem,
  NlpInfo,
} from "./types";

/**
 * Conversões de registros snake_case (colunas do banco = chaves do snapshot) para os tipos do web.
 * Compartilhadas pelo SnapshotSource e pelo PostgresSource.
 */

type Raw = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toAnomalia(r: Raw): Anomalia {
  return {
    ticker: String(r.ticker),
    dia: String(r.dia),
    metodo: r.metodo as Anomalia["metodo"],
    valor: Number(r.valor),
    severidade: r.severidade as Anomalia["severidade"],
    detalhes: (r.detalhes ?? {}) as Anomalia["detalhes"],
  };
}

export function toGarch(r: Raw | null | undefined): GarchInfo | null {
  if (!r) return null;
  return {
    distribuicao: String(r.distribuicao),
    alpha: Number(r.alpha),
    beta: Number(r.beta),
    nu: num(r.nu),
    persistencia: Number(r.persistencia),
    meiaVida: num(r.meia_vida),
    volLongoPrazo: num(r.vol_longo_prazo),
    n: Number(r.n),
    convergiu: Boolean(r.convergiu),
    ultimoDia: String(r.ultimo_dia),
    previsao: ((r.previsao as unknown[]) ?? []).map(Number),
  };
}

type DiaRaw = [number, string, number, number, number, number];

export function toEventStudy(r: Raw): EventStudy {
  const serie = (r.serie as Raw | undefined) ?? r;
  return {
    dataEvento: String(r.data_evento),
    janela: String(r.janela),
    origem: String(r.origem_tipo),
    rotulo: (r.rotulo as string | null) ?? null,
    car: Number(r.car),
    tStat: Number(r.t_stat),
    pValor: Number(r.p_valor),
    icInf: Number(r.ic_inf),
    icSup: Number(r.ic_sup),
    nEstimacao: Number(r.n_estimacao),
    alpha: num(r.alpha),
    beta: num(r.beta),
    r2: num(r.r2),
    nivelConfianca: Number(serie.nivel_confianca ?? 0.95),
    dias: ((serie.dias as DiaRaw[]) ?? []).map(([rel, dia, ar, car, icInf, icSup]) => ({
      rel,
      dia,
      ar,
      car,
      icInf,
      icSup,
    })),
  };
}

export function toComponentes(raw: unknown): Record<string, ComponenteScore> {
  const out: Record<string, ComponenteScore> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, Raw>)) {
    out[k] = {
      rotulo: String(v.rotulo),
      fator: num(v.fator),
      peso: Number(v.peso),
      pesoEfetivo: Number(v.peso_efetivo),
      pontos: Number(v.pontos),
      disponivel: Boolean(v.disponivel),
      ...(v.pregao ? { pregao: String(v.pregao) } : {}),
    };
  }
  return out;
}

export function toHistoria(r: Raw): Historia {
  return {
    id: Number(r.id),
    titulo: String(r.titulo),
    resumo: (r.resumo as string | null) ?? null,
    primeiraEm: String(r.primeira_em),
    ultimaEm: String(r.ultima_em),
    tickers: ((r.tickers as string[]) ?? []).map(String),
    fontes: ((r.fontes as string[]) ?? []).map(String),
    nFontes: Number(r.n_fontes),
    tipoEvento: (r.tipo_evento as string | null) ?? null,
    materialidade: (r.materialidade as Historia["materialidade"]) ?? null,
    sentimento: num(r.sentimento),
    score: Number(r.score),
    componentes: toComponentes(r.componentes),
    extracao: (r.extracao as Historia["extracao"]) ?? null,
    itens: ((r.itens as Raw[]) ?? []).map((i) => ({
      tipo: i.tipo as HistoriaItem["tipo"],
      titulo: String(i.titulo),
      fonte: String(i.fonte),
      link: String(i.link),
      publicadoEm: String(i.publicado_em),
      sentimento: (i.sentimento as HistoriaItem["sentimento"]) ?? null,
    })),
  };
}

export function toNlpInfo(r: Raw | null): NlpInfo {
  const c = (r?.concordancia as Raw | null) ?? null;
  return {
    concordancia: c
      ? {
          n: Number(c.n),
          kappa: num(c.kappa),
          concordancia: num(c.concordancia),
          matriz: (c.matriz ?? {}) as Record<string, Record<string, number>>,
          calculadoEm: String(c.calculado_em),
        }
      : null,
    extracoes: ((r?.extracoes as Raw[]) ?? []).map((e) => ({
      metodo: String(e.metodo),
      status: String(e.status),
      n: Number(e.n),
    })),
  };
}

export function toGrafos(
  correlacao: Raw | null,
  conhecimento: Raw | null,
  choque: Raw | null,
): Grafos {
  const snaps = ((correlacao?.snapshots as Raw[]) ?? []).map((s) => {
    const m = (s.metricas ?? {}) as Raw;
    return {
      referencia: String(s.referencia),
      nObs: Number(s.n_obs),
      metricas: {
        rhoMedio: num(m.rho_medio),
        nComunidades: Number(m.n_comunidades ?? 0),
        comprimentoMst: Number(m.comprimento_mst ?? 0),
      },
      nos: (s.nos as Grafos["correlacao"][number]["nos"]) ?? [],
      arestas: (s.arestas as Grafos["correlacao"][number]["arestas"]) ?? [],
    };
  });
  return {
    correlacao: snaps,
    conhecimento: conhecimento
      ? {
          referencia: String(conhecimento.referencia),
          nos: (conhecimento.nos as NonNullable<Grafos["conhecimento"]>["nos"]) ?? [],
          arestas: (conhecimento.arestas as NonNullable<Grafos["conhecimento"]>["arestas"]) ?? [],
        }
      : null,
    choque: choque
      ? {
          referencia: String(choque.referencia),
          sementes: (choque.sementes as NonNullable<Grafos["choque"]>["sementes"]) ?? [],
          rankings: (choque.rankings as NonNullable<Grafos["choque"]>["rankings"]) ?? {},
        }
      : null,
  };
}

type RawBriefing = Omit<Briefing, "geradoEm"> & { gerado_em: string };
export function toBriefing(r: RawBriefing): Briefing {
  return {
    dia: r.dia,
    versao: r.versao,
    geradoEm: r.gerado_em,
    metodo: r.metodo,
    secoes: r.secoes,
    fontes: r.fontes,
    aviso: r.aviso,
  };
}

export function toExecucao(r: {
  etapa: string;
  status: Execucao["status"];
  iniciado_em: string;
  duracao_ms: number | null;
  contagens: Record<string, number> | null;
  erro: string | null;
  gatilho: string;
}): Execucao {
  return {
    etapa: r.etapa,
    status: r.status,
    iniciadoEm: r.iniciado_em,
    duracaoMs: r.duracao_ms,
    contagens: r.contagens ?? {},
    erro: r.erro,
    gatilho: r.gatilho,
  };
}
