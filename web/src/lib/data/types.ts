export type SourceKind = "snapshot" | "postgres";

export type DataMeta = {
  kind: SourceKind;
  /** true quando o banco falhou e o site caiu para o snapshot (ADR 0002). */
  fallback: boolean;
  /** ISO 8601 da última coleta de preços bem-sucedida; null se ainda não há dados. */
  lastUpdated: string | null;
  /** Data (AAAA-MM-DD) do último pregão com fechamento do Ibovespa. */
  ultimoPregao: string | null;
};

export type DailyBar = {
  dia: string; // AAAA-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjClose: number | null;
  volume: number | null;
};

export type IntradayPoint = {
  ts: string; // ISO 8601 com fuso
  close: number;
  volume: number | null;
};

export type MacroObs = { dia: string; valor: number };

export type MacroSerie = {
  codigo: number;
  slug: string;
  nome: string;
  unidade: string;
  periodicidade: "diaria" | "mensal";
  observacoes: MacroObs[];
};

export type Severidade = "baixa" | "media" | "alta";
export type MetodoAnomalia = "robust_z_retorno" | "robust_z_volume" | "change_point";

export type Anomalia = {
  ticker: string;
  dia: string;
  metodo: MetodoAnomalia;
  /** z robusto (retorno/volume) ou razão de volatilidade depois/antes (change point). */
  valor: number;
  severidade: Severidade;
  detalhes: Record<string, number | string>;
};

export type GarchInfo = {
  distribuicao: string;
  alpha: number;
  beta: number;
  nu: number | null;
  persistencia: number;
  meiaVida: number | null;
  volLongoPrazo: number | null;
  n: number;
  convergiu: boolean;
  ultimoDia: string;
  /** Volatilidade anualizada prevista para os próximos pregões. */
  previsao: number[];
};

export type VolPoint = { dia: string; garch: number | null; realizada: number | null };

export type EventStudyDia = {
  rel: number;
  dia: string;
  ar: number;
  car: number;
  icInf: number;
  icSup: number;
};

export type EventStudy = {
  dataEvento: string;
  janela: string;
  origem: string;
  rotulo: string | null;
  car: number;
  tStat: number;
  pValor: number;
  icInf: number;
  icSup: number;
  nEstimacao: number;
  alpha: number | null;
  beta: number | null;
  r2: number | null;
  nivelConfianca: number;
  dias: EventStudyDia[];
};

export type AssetStatsData = {
  anomalias: Anomalia[];
  garch: GarchInfo | null;
  volatilidade: VolPoint[];
  eventStudies: EventStudy[];
};

export type ComponenteScore = {
  rotulo: string;
  fator: number | null;
  peso: number;
  pesoEfetivo: number;
  pontos: number;
  disponivel: boolean;
  /** Para a reação de mercado: o pregão comparado. */
  pregao?: string;
};

export type HistoriaItem = {
  tipo: "noticia" | "cvm";
  titulo: string;
  fonte: string;
  link: string;
  publicadoEm: string;
  sentimento: "positivo" | "neutro" | "negativo" | null;
};

export type Historia = {
  id: number;
  titulo: string;
  resumo: string | null;
  primeiraEm: string;
  ultimaEm: string;
  tickers: string[];
  fontes: string[];
  nFontes: number;
  tipoEvento: string | null;
  materialidade: "baixa" | "media" | "alta" | null;
  /** −1 (negativo) a +1 (positivo), média do FinBERT nos itens. */
  sentimento: number | null;
  score: number;
  componentes: Record<string, ComponenteScore>;
  /** Como a extração foi feita: LLM, regras (sem LLM disponível) ou ainda não extraída. */
  extracao: "llm" | "regras" | null;
  itens: HistoriaItem[];
};

export type NlpInfo = {
  concordancia: {
    n: number;
    kappa: number | null;
    concordancia: number | null;
    matriz: Record<string, Record<string, number>>;
    calculadoEm: string;
  } | null;
  extracoes: { metodo: string; status: string; n: number }[];
};

export interface DataSource {
  meta(): Promise<DataMeta>;
  /** Últimos `n` pregões de cada ticker (inclui o índice). */
  recentDaily(n: number): Promise<Record<string, DailyBar[]>>;
  daily(ticker: string): Promise<DailyBar[]>;
  intraday(ticker: string): Promise<IntradayPoint[]>;
  macro(): Promise<MacroSerie[]>;
  /** Anomalias do universo nos últimos ~30 dias, mais recentes e extremas primeiro. */
  recentAnomalies(): Promise<Anomalia[]>;
  assetStats(ticker: string): Promise<AssetStatsData>;
  /** Histórias pontuadas dos últimos ~21 dias, da mais relevante para a menos. */
  historias(): Promise<Historia[]>;
  nlpInfo(): Promise<NlpInfo>;
  grafos(): Promise<Grafos>;
  /** Vetores-semente centralizados das histórias e o vetor médio (busca semântica do agente). */
  vetores(): Promise<VetoresHistorias>;
  /** Última versão do briefing de cada um dos dias mais recentes (mais novo primeiro). */
  briefings(): Promise<Briefing[]>;
  /** Execuções recentes do pipeline (mais nova primeiro). */
  execucoes(): Promise<Execucao[]>;
}

// ------------------------------------------------------------------ briefing e status (fase 7)
export type FonteBriefing = {
  n: number;
  titulo: string;
  link: string;
  origem: string;
  data: string;
};
export type Briefing = {
  dia: string;
  versao: number;
  geradoEm: string;
  metodo: string;
  secoes: { id: string; titulo: string; itens: { texto: string; refs: number[] }[] }[];
  fontes: FonteBriefing[];
  aviso: string;
};
export type Execucao = {
  etapa: string;
  status: "rodando" | "ok" | "parcial" | "falhou";
  iniciadoEm: string;
  duracaoMs: number | null;
  contagens: Record<string, number>;
  erro: string | null;
  gatilho: string;
};

export type VetoresHistorias = { media: number[] | null; porHistoria: Record<number, number[]> };

// ------------------------------------------------------------------ grafos (fase 5)
export type NoCorrelacao = {
  id: string;
  setor: string | null;
  comunidade: number;
  x: number;
  y: number;
  grau: number;
  intermediacao: number;
  autovetor: number;
};

export type SnapshotCorrelacao = {
  referencia: string;
  nObs: number;
  metricas: { rhoMedio: number | null; nComunidades: number; comprimentoMst: number };
  nos: NoCorrelacao[];
  arestas: { source: string; target: string; rho: number; dist: number }[];
};

export type NoConhecimento = {
  id: string;
  tipo: "Empresa" | "Setor" | "Pessoa" | "Acionista" | "Evento";
  rotulo: string;
  x: number;
  y: number;
  grau: number;
  ticker?: string;
};

export type ArestaConhecimento = {
  source: string;
  target: string;
  relacao: string;
  peso: number;
  cargo?: string;
  percentual?: number;
};

export type PassoChoque = { de: string; para: string; motivo: string; detalhe: string };
export type ImpactoChoque = { id: string; rotulo: string; impacto: number; caminho: PassoChoque[] };

export type Grafos = {
  correlacao: SnapshotCorrelacao[];
  conhecimento: { referencia: string; nos: NoConhecimento[]; arestas: ArestaConhecimento[] } | null;
  choque: {
    referencia: string;
    sementes: { id: string; rotulo: string; tipo: string }[];
    rankings: Record<string, ImpactoChoque[]>;
  } | null;
};
