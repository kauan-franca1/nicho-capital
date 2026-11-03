import postgres from "postgres";

import {
  toAnomalia,
  toBriefing,
  toEventStudy,
  toExecucao,
  toGarch,
  toHistoria,
  toNlpInfo,
  toGrafos,
} from "./mappers";
import type {
  Anomalia,
  AssetStatsData,
  Briefing,
  Execucao,
  DailyBar,
  DataMeta,
  DataSource,
  Grafos,
  Historia,
  IntradayPoint,
  MacroSerie,
  NlpInfo,
  VetoresHistorias,
} from "./types";

/**
 * Lê o Postgres (Supabase ou local) com o schema de db/migrations.
 * Os `numeric` são convertidos para float8 no SQL: o postgres.js os devolveria como string.
 */

let client: postgres.Sql | null = null;

function sql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  client ??= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 5, prepare: false });
  return client;
}

type BarRow = {
  ticker: string;
  dia: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adj_close: number | null;
  volume: number | null;
};

const toBar = (r: BarRow): DailyBar => ({
  dia: r.dia,
  open: r.open,
  high: r.high,
  low: r.low,
  close: r.close,
  adjClose: r.adj_close,
  volume: r.volume,
});

export class PostgresSource implements DataSource {
  async meta(): Promise<DataMeta> {
    const [row] = await sql()<{ ultima: string | null; pregao: string | null }[]>`
      select
        (select to_char(max(terminado_em) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           from pipeline_runs where etapa = 'precos' and status in ('ok', 'parcial')) as ultima,
        (select max(dia)::text from prices_daily where ticker = '^BVSP') as pregao`;
    return {
      kind: "postgres",
      fallback: false,
      lastUpdated: row?.ultima ?? null,
      ultimoPregao: row?.pregao ?? null,
    };
  }

  async daily(ticker: string): Promise<DailyBar[]> {
    const rows = await sql()<BarRow[]>`
      select ticker, dia::text, open::float8, high::float8, low::float8, close::float8,
             adj_close::float8, volume::float8 as volume
      from prices_daily where ticker = ${ticker} order by dia`;
    return rows.map(toBar);
  }

  async recentDaily(n: number): Promise<Record<string, DailyBar[]>> {
    const rows = await sql()<BarRow[]>`
      select ticker, dia::text, open::float8, high::float8, low::float8, close::float8,
             adj_close::float8, volume::float8 as volume
      from (
        select *, row_number() over (partition by ticker order by dia desc) as rn
        from prices_daily
      ) t
      where rn <= ${n}
      order by ticker, dia`;
    const out: Record<string, DailyBar[]> = {};
    for (const r of rows) (out[r.ticker] ??= []).push(toBar(r));
    return out;
  }

  async intraday(ticker: string): Promise<IntradayPoint[]> {
    const rows = await sql()<{ ts: string; close: number; volume: number | null }[]>`
      select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ts,
             close::float8, volume::float8 as volume
      from prices_intraday where ticker = ${ticker} order by ts`;
    return rows.map((r) => ({ ts: r.ts, close: r.close, volume: r.volume }));
  }

  async macro(): Promise<MacroSerie[]> {
    const series = await sql()<Omit<MacroSerie, "observacoes">[]>`
      select codigo_sgs as codigo, slug, nome, unidade, periodicidade
      from macro_series order by codigo_sgs`;
    const obs = await sql()<{ codigo: number; dia: string; valor: number }[]>`
      select codigo_sgs as codigo, dia::text, valor::float8
      from macro_observations order by codigo_sgs, dia`;
    return series.map((s) => ({
      ...s,
      observacoes: obs
        .filter((o) => o.codigo === s.codigo)
        .map(({ dia, valor }) => ({ dia, valor })),
    }));
  }

  async recentAnomalies(): Promise<Anomalia[]> {
    const rows = await sql()`
      select ticker, dia::text, metodo, valor::float8, severidade, detalhes
      from anomalies
      where dia >= (select max(dia) - 30 from anomalies)
      order by dia desc, abs(valor) desc`;
    return rows.map((r) => toAnomalia(r));
  }

  async assetStats(ticker: string): Promise<AssetStatsData> {
    const [anomalias, garch, vol, estudos] = await Promise.all([
      sql()`
        select ticker, dia::text, metodo, valor::float8, severidade, detalhes
        from anomalies where ticker = ${ticker} order by dia, metodo`,
      sql()`
        select distribuicao, alpha, beta, nu, persistencia, meia_vida, vol_longo_prazo, n,
               convergiu, ultimo_dia::text, previsao
        from garch_fits where ticker = ${ticker}`,
      sql()<{ dia: string; garch: number | null; realizada: number | null }[]>`
        select dia::text, vol_garch as garch, vol_realizada_21 as realizada
        from volatility_daily where ticker = ${ticker} order by dia`,
      sql()`
        select data_evento::text, janela, origem_tipo, rotulo, car, t_stat, p_valor, ic_inf,
               ic_sup, n_estimacao, alpha, beta, r2, serie
        from event_studies where ticker = ${ticker} order by data_evento, janela`,
    ]);
    return {
      anomalias: anomalias.map((r) => toAnomalia(r)),
      garch: toGarch(garch[0]),
      volatilidade: vol.map((v) => ({ dia: v.dia, garch: v.garch, realizada: v.realizada })),
      eventStudies: estudos.map((r) => toEventStudy(r)),
    };
  }

  async historias(): Promise<Historia[]> {
    const rows = await sql()`
      select s.id, s.titulo, s.resumo, to_char(s.primeira_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as primeira_em,
             to_char(s.ultima_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ultima_em, s.tickers, s.fontes, s.n_fontes,
             s.tipo_evento, s.materialidade, s.sentimento::float8, r.score::float8, r.componentes,
             (select case when bool_or(e.metodo = 'llm') then 'llm'
                          when count(e.*) > 0 then 'regras' end
                from story_items si
                left join extractions e on e.news_item_id = si.news_item_id
                                        or e.filing_id = si.filing_id
               where si.story_id = s.id) as extracao,
             (select coalesce(json_agg(i order by i.publicado_em), '[]'::json) from (
                select 'noticia' as tipo, n.titulo, n.fonte_nome as fonte, n.link,
                       to_char(n.publicado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as publicado_em,
                       (select label from sentiment x where x.news_item_id = n.id
                          and x.modelo not like 'llm:%' limit 1) as sentimento
                  from story_items si join news_items n on n.id = si.news_item_id
                 where si.story_id = s.id
                union all
                select 'cvm', f.categoria || ': ' || coalesce(f.assunto, ''), 'CVM',
                       f.link_download, to_char(f.data_entrega at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       (select label from sentiment x where x.filing_id = f.id
                          and x.modelo not like 'llm:%' limit 1)
                  from story_items si join filings f on f.id = si.filing_id
                 where si.story_id = s.id) i) as itens
      from stories s join relevance_scores r on r.story_id = s.id
      where s.ultima_em >= (select max(ultima_em) from stories) - interval '21 days'
      order by r.score desc, s.ultima_em desc
      limit 800`;
    return rows.map((r) => toHistoria(r));
  }

  async nlpInfo(): Promise<NlpInfo> {
    const [acordo] = await sql()`
      select n, kappa, concordancia, matriz, calculado_em::text
      from sentiment_agreement order by calculado_em desc limit 1`;
    const extracoes = await sql()`
      select metodo, status, count(*)::int as n from extractions group by 1, 2 order by 1, 2`;
    return toNlpInfo({ concordancia: acordo ?? null, extracoes });
  }

  async grafos(): Promise<Grafos> {
    const snaps = await sql()<
      { referencia: string; payload: Record<string, unknown>; metricas: unknown }[]
    >`
      select referencia::text, payload, metricas from graph_snapshots
      where tipo = 'correlacao_mst' order by referencia`;
    const ultimo = async (tipo: string) => {
      const [r] = await sql()<{ referencia: string; payload: Record<string, unknown> }[]>`
        select referencia::text, payload from graph_snapshots
        where tipo = ${tipo} order by referencia desc limit 1`;
      return r ? { referencia: r.referencia, ...r.payload } : null;
    };
    return toGrafos(
      {
        snapshots: snaps.map((s) => ({
          referencia: s.referencia,
          metricas: s.metricas,
          ...s.payload,
        })),
      },
      await ultimo("conhecimento"),
      await ultimo("choque"),
    );
  }

  async vetores(): Promise<VetoresHistorias> {
    const [m] = await sql()<{ valor: number[] }[]>`
      select valor from nlp_state where chave = 'embedding_media'`;
    const rows = await sql()<{ id: number; v: string }[]>`
      select s.id, s.centroid::text as v from stories s
      where s.ultima_em >= (select max(ultima_em) from stories) - interval '21 days'
        and s.centroid is not null`;
    const porHistoria: Record<number, number[]> = {};
    for (const r of rows) porHistoria[Number(r.id)] = JSON.parse(r.v) as number[];
    return { media: m?.valor ?? null, porHistoria };
  }

  async briefings(): Promise<Briefing[]> {
    const rows = await sql()<{ conteudo: Parameters<typeof toBriefing>[0] }[]>`
      select distinct on (dia) conteudo from briefings
      order by dia desc, versao desc limit 10`;
    return rows.map((r) => toBriefing(r.conteudo));
  }

  async execucoes(): Promise<Execucao[]> {
    const rows = await sql()<Parameters<typeof toExecucao>[0][]>`
      select etapa, status, iniciado_em::text, duracao_ms, contagens, erro, gatilho
      from pipeline_runs order by iniciado_em desc limit 60`;
    return rows.map(toExecucao);
  }
}
