import { CarChartLazy as CarChart, VolChartLazy as VolChart } from "@/components/charts/lazy";
import { Delta } from "@/components/delta";
import { AnomaliaTable } from "@/components/stats/anomalies";
import { EmptyState } from "@/components/states";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { Anomalia, EventStudy, GarchInfo, VolPoint } from "@/lib/data/types";
import { describePercent, formatDateBr, formatNumber, formatPercent } from "@/lib/format";

const pctAno = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${formatNumber(v * 100, 1)}% a.a.`;

export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return p < 0.001 ? "p < 0,001" : `p = ${formatNumber(p, 3)}`;
}

// ------------------------------------------------------------------ GARCH
function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-label font-medium uppercase text-muted">{rotulo}</dt>
      <dd className="text-body font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function GarchCard({
  ticker,
  garch,
  volatilidade,
}: {
  ticker: string;
  garch: GarchInfo | null;
  volatilidade: VolPoint[];
}) {
  const ultima = volatilidade.at(-1);
  return (
    <Card aria-labelledby="card-garch">
      <CardHeader>
        <CardTitle id="card-garch">Volatilidade (GARCH)</CardTitle>
        <span className="text-small text-muted">linha cheia: GARCH · tracejada: realizada 21d</span>
      </CardHeader>
      {!garch || volatilidade.length === 0 ? (
        <EmptyState title="Sem ajuste GARCH" className="p-16">
          Rode <code className="font-mono text-small">nicho stats</code> para estimar o modelo.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-16">
          <VolChart
            pontos={volatilidade}
            label={`Volatilidade anualizada de ${ticker}: GARCH(1,1) em ${pctAno(ultima?.garch)} e realizada de 21 pregões em ${pctAno(ultima?.realizada)} no último pregão.`}
          />
          <dl className="grid grid-cols-2 gap-12 sm:grid-cols-4">
            <Item rotulo="Vol. hoje (GARCH)">{pctAno(ultima?.garch)}</Item>
            <Item rotulo={`Previsão ${garch.previsao.length} pregões`}>
              {pctAno(garch.previsao.at(-1))}
            </Item>
            <Item rotulo="Longo prazo">{pctAno(garch.volLongoPrazo)}</Item>
            <Item rotulo="Meia-vida do choque">
              {garch.meiaVida === null ? "—" : `${formatNumber(garch.meiaVida, 0)} pregões`}
            </Item>
            <Item rotulo="α (reação)">{formatNumber(garch.alpha, 3)}</Item>
            <Item rotulo="β (memória)">{formatNumber(garch.beta, 3)}</Item>
            <Item rotulo="Persistência α+β">{formatNumber(garch.persistencia, 3)}</Item>
            <Item rotulo="Distribuição">
              {garch.distribuicao === "t" && garch.nu !== null
                ? `t de Student, ν = ${formatNumber(garch.nu, 1)}`
                : "normal"}
            </Item>
          </dl>
          <p className="text-small text-muted">
            Ajuste com {garch.n} pregões até {formatDateBr(garch.ultimoDia)}
            {garch.convergiu ? "." : " — atenção: o otimizador não convergiu."} A série é in-sample:
            os parâmetros usam a amostra inteira; a previsão usa só dados até o último pregão.
          </p>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ anomalias
export function AnomaliasCard({ anomalias }: { anomalias: Anomalia[] }) {
  const recentes = [...anomalias].sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, 12);
  return (
    <Card aria-labelledby="card-anomalias">
      <CardHeader>
        <CardTitle id="card-anomalias">Anomalias</CardTitle>
        <span className="text-small text-muted">últimas {recentes.length}</span>
      </CardHeader>
      {recentes.length === 0 ? (
        <EmptyState title="Nenhuma anomalia no último ano" className="p-16">
          Nenhum retorno ou volume passou do limiar de z robusto, e não houve mudança de regime.
        </EmptyState>
      ) : (
        <AnomaliaTable anomalias={recentes} caption="Anomalias recentes do ativo" />
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ event studies
function Resultado({ es }: { es: EventStudy }) {
  const significativo = es.pValor < 1 - es.nivelConfianca;
  return (
    <div className="flex flex-col gap-4 rounded-md border border-default p-12">
      <div className="flex flex-wrap items-baseline justify-between gap-8">
        <span className="font-mono text-small tracking-[0.05em] text-muted">CAR {es.janela}</span>
        <span className={significativo ? "text-small font-semibold" : "text-small text-muted"}>
          {significativo
            ? `significativo a ${Math.round((1 - es.nivelConfianca) * 100)}%`
            : "não significativo"}
        </span>
      </div>
      <Delta value={es.car} className="text-heading-sm" />
      <p className="text-small text-muted tabular-nums">
        t = {formatNumber(es.tStat, 2)} · {formatP(es.pValor)} · IC{" "}
        {Math.round(es.nivelConfianca * 100)}% [{formatPercent(es.icInf, 1)};{" "}
        {formatPercent(es.icSup, 1)}]
      </p>
      <p className="text-small text-muted tabular-nums">
        β = {es.beta === null ? "—" : formatNumber(es.beta, 2)} · R² ={" "}
        {es.r2 === null ? "—" : formatNumber(es.r2, 2)} · {es.nEstimacao} pregões de estimação
      </p>
    </div>
  );
}

export function EventStudiesCard({ ticker, estudos }: { ticker: string; estudos: EventStudy[] }) {
  const porEvento = new Map<string, EventStudy[]>();
  for (const es of estudos) {
    const k = `${es.dataEvento}|${es.rotulo ?? ""}`;
    porEvento.set(k, [...(porEvento.get(k) ?? []), es]);
  }
  const eventos = [...porEvento.values()].sort((a, b) =>
    b[0].dataEvento.localeCompare(a[0].dataEvento),
  );

  return (
    <Card aria-labelledby="card-es">
      <CardHeader>
        <CardTitle id="card-es">Event studies</CardTitle>
        <span className="text-small text-muted">modelo de mercado contra o Ibovespa</span>
      </CardHeader>
      <p className="mb-16 max-w-[720px] text-small text-muted">
        Retorno anormal acumulado (CAR): quanto o ativo se moveu além do que o Ibovespa explicaria
        pelo seu beta. A faixa é o intervalo de confiança. Os eventos de fatos relevantes e notícias
        entram na fase 4; por ora, os eventos são os choques do próprio índice.
      </p>
      {eventos.length === 0 ? (
        <EmptyState title="Nenhum evento com janela completa" className="p-16">
          Os estudos aparecem quando há histórico de estimação e a janela do evento já terminou.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-24">
          {eventos.map((grupo) => {
            const maior = [...grupo].sort((a, b) => b.dias.length - a.dias.length)[0];
            return (
              <section
                key={`${maior.dataEvento}-${maior.rotulo}`}
                aria-label={maior.rotulo ?? `Evento de ${formatDateBr(maior.dataEvento)}`}
                className="flex flex-col gap-12 border-t border-default pt-16 first:border-0 first:pt-0"
              >
                <h3 className="text-body font-medium">
                  {maior.rotulo ?? `Evento de ${formatDateBr(maior.dataEvento)}`}
                </h3>
                <div className="grid gap-16 lg:grid-cols-[1fr_minmax(0,1.2fr)]">
                  <div className="grid content-start gap-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {grupo.map((es) => (
                      <Resultado key={es.janela} es={es} />
                    ))}
                  </div>
                  <CarChart
                    dias={maior.dias}
                    nivel={maior.nivelConfianca}
                    label={`CAR de ${ticker} na janela ${maior.janela} em torno de ${formatDateBr(maior.dataEvento)}: ${describePercent(maior.car)}, ${formatP(maior.pValor)}.`}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
