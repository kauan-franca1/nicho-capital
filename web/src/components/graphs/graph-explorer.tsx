"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Grafos, ImpactoChoque } from "@/lib/data/types";
import { formatDateBr, formatNumber } from "@/lib/format";

import { SigmaGraph, type ArestaVisual, type NoVisual } from "./sigma-graph";

const CINZAS = ["--viz-cinza-1", "--viz-cinza-2", "--viz-cinza-3", "--viz-cinza-4"];
const ABAS = [
  { id: "correlacao", rotulo: "Correlação" },
  { id: "conhecimento", rotulo: "Conhecimento" },
  { id: "choque", rotulo: "Choque" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

export function GraphExplorer({
  grafos,
  setores,
}: {
  grafos: Grafos;
  setores: Record<string, string>;
}) {
  const [aba, setAba] = useState<Aba>("correlacao");
  const base = useId();
  return (
    <div className="flex flex-col gap-16">
      <div role="tablist" aria-label="Tipo de grafo" className="flex gap-4 border-b border-default">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            id={`${base}-tab-${a.id}`}
            aria-selected={aba === a.id}
            aria-controls={`${base}-painel-${a.id}`}
            tabIndex={aba === a.id ? 0 : -1}
            onClick={() => setAba(a.id)}
            onKeyDown={(e) => {
              const i = ABAS.findIndex((x) => x.id === aba);
              if (e.key === "ArrowRight") setAba(ABAS[(i + 1) % ABAS.length].id);
              if (e.key === "ArrowLeft") setAba(ABAS[(i + ABAS.length - 1) % ABAS.length].id);
            }}
            className={cn(
              "-mb-px border-b px-12 py-8 text-data transition-colors duration-(--duration-fast)",
              aba === a.id
                ? "border-(--color-fog) text-primary"
                : "border-transparent text-muted hover:text-primary",
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-painel-${aba}`} aria-labelledby={`${base}-tab-${aba}`}>
        {aba === "correlacao" ? <AbaCorrelacao grafos={grafos} setores={setores} /> : null}
        {aba === "conhecimento" ? <AbaConhecimento grafos={grafos} /> : null}
        {aba === "choque" ? <AbaChoque grafos={grafos} /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ correlação
function AbaCorrelacao({ grafos, setores }: { grafos: Grafos; setores: Record<string, string> }) {
  const snaps = grafos.correlacao;
  const [i, setI] = useState(snaps.length - 1);
  const [tocando, setTocando] = useState(false);
  const [comunidade, setComunidade] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const s = snaps[i];

  useEffect(() => {
    if (!tocando) return;
    const t = setInterval(() => {
      setI((x) => {
        if (x >= snaps.length - 1) {
          setTocando(false);
          return x;
        }
        return x + 1;
      });
    }, 1200);
    return () => clearInterval(t);
  }, [tocando, snaps.length]);

  const { nos, arestas, grupos } = useMemo(() => {
    if (!s) return { nos: [], arestas: [], grupos: [] as { id: number; membros: string[] }[] };
    const maxGrau = Math.max(...s.nos.map((n) => n.grau), 0.0001);
    const nos: NoVisual[] = s.nos.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      size: 4 + 10 * (n.grau / maxGrau),
      cor: CINZAS[n.comunidade % CINZAS.length],
      label: n.id,
      rotuloSempre: true,
    }));
    const arestas: ArestaVisual[] = s.arestas.map((e) => ({
      source: e.source,
      target: e.target,
      size: 1 + 3 * Math.max(e.rho, 0),
      cor: "--viz-aresta",
    }));
    const porCom = new Map<number, string[]>();
    for (const n of s.nos) porCom.set(n.comunidade, [...(porCom.get(n.comunidade) ?? []), n.id]);
    const grupos = [...porCom.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, membros]) => ({ id, membros: membros.sort() }));
    return { nos, arestas, grupos };
  }, [s]);

  const destaque = useMemo(() => {
    if (sel) {
      const viz = new Set([sel]);
      for (const e of s?.arestas ?? []) {
        if (e.source === sel) viz.add(e.target);
        if (e.target === sel) viz.add(e.source);
      }
      return viz;
    }
    if (comunidade !== null) return new Set(grupos.find((g) => g.id === comunidade)?.membros ?? []);
    return null;
  }, [sel, comunidade, grupos, s]);

  if (!s)
    return (
      <p className="text-muted">
        Sem snapshots de correlação. Rode <code>nicho grafos</code>.
      </p>
    );
  const noSel = s.nos.find((n) => n.id === sel);
  const centrais = [...s.nos].sort((a, b) => b.autovetor - a.autovetor).slice(0, 5);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card aria-labelledby="card-mst">
        <CardHeader>
          <CardTitle id="card-mst">Árvore geradora mínima · {formatDateBr(s.referencia)}</CardTitle>
          <span className="text-small text-muted">janela de 90 dias · {s.nObs} pregões</span>
        </CardHeader>
        <SigmaGraph
          nos={nos}
          arestas={arestas}
          destaque={destaque}
          selecionado={sel}
          onSelecionar={setSel}
          label={`Árvore geradora mínima das correlações em ${formatDateBr(s.referencia)}: ${s.nos.length} ativos em ${s.metricas.nComunidades} comunidades, correlação média ${formatNumber(s.metricas.rhoMedio ?? 0, 2)}. Comunidades listadas ao lado.`}
        />
        <div className="mt-12 flex flex-wrap items-center gap-12">
          <Button
            size="sm"
            onClick={() =>
              tocando ? setTocando(false) : (setI(i >= snaps.length - 1 ? 0 : i), setTocando(true))
            }
          >
            {tocando ? "Pausar" : "Animar 24 meses"}
          </Button>
          <label className="flex min-w-0 flex-1 items-center gap-8 text-small text-muted">
            <span className="shrink-0">Mês</span>
            <input
              type="range"
              min={0}
              max={snaps.length - 1}
              value={i}
              onChange={(e) => {
                setTocando(false);
                setI(Number(e.target.value));
              }}
              aria-valuetext={formatDateBr(s.referencia)}
              className="w-full accent-(--color-bone)"
            />
            <span className="shrink-0 tabular-nums text-primary">{formatDateBr(s.referencia)}</span>
          </label>
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-12">
        <Card aria-labelledby="card-mst-metricas">
          <CardHeader>
            <CardTitle id="card-mst-metricas">Leitura do mês</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-8 text-small">
            <dt className="text-muted">Correlação média</dt>
            <dd className="text-right tabular-nums">{formatNumber(s.metricas.rhoMedio ?? 0, 2)}</dd>
            <dt className="text-muted">Comunidades</dt>
            <dd className="text-right tabular-nums">{s.metricas.nComunidades}</dd>
            <dt className="text-muted">Comprimento da árvore</dt>
            <dd className="text-right tabular-nums">
              {formatNumber(s.metricas.comprimentoMst, 1)}
            </dd>
          </dl>
          <p className="mt-8 text-small text-muted">
            Árvore mais curta e correlação média alta = mercado andando junto (risco sistêmico).
          </p>
        </Card>

        {noSel ? (
          <Card aria-labelledby="card-no-sel">
            <CardHeader>
              <CardTitle id="card-no-sel">{noSel.id}</CardTitle>
              <Link href={`/ativo/${noSel.id}`} className="text-small text-link hover:underline">
                Abrir ativo →
              </Link>
            </CardHeader>
            <dl className="grid grid-cols-2 gap-8 text-small">
              <dt className="text-muted">Setor</dt>
              <dd className="text-right">{noSel.setor ? setores[noSel.setor] : "—"}</dd>
              <dt className="text-muted">Comunidade</dt>
              <dd className="text-right tabular-nums">{noSel.comunidade + 1}</dd>
              <dt className="text-muted">Intermediação</dt>
              <dd className="text-right tabular-nums">{formatNumber(noSel.intermediacao, 3)}</dd>
              <dt className="text-muted">Autovetor</dt>
              <dd className="text-right tabular-nums">{formatNumber(noSel.autovetor, 3)}</dd>
            </dl>
          </Card>
        ) : null}

        <Card aria-labelledby="card-comunidades">
          <CardHeader>
            <CardTitle id="card-comunidades">Comunidades (Louvain)</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-8">
            {grupos.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  aria-pressed={comunidade === g.id}
                  onClick={() => {
                    setSel(null);
                    setComunidade(comunidade === g.id ? null : g.id);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-md border px-8 py-6 text-left text-small",
                    comunidade === g.id ? "border-primary" : "border-default hover:bg-surface-3",
                  )}
                >
                  <span className="flex items-center gap-8 font-medium">
                    <span
                      aria-hidden="true"
                      className="inline-block size-10 rounded-full"
                      style={{ background: `var(${CINZAS[g.id % CINZAS.length]})` }}
                    />
                    Comunidade {g.id + 1} · {g.membros.length}
                  </span>
                  <span className="font-mono text-muted">{g.membros.join(" ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="card-centrais">
          <CardHeader>
            <CardTitle id="card-centrais">Mais centrais</CardTitle>
            <span className="text-small text-muted">autovetor</span>
          </CardHeader>
          <ol className="flex flex-col gap-4 text-small">
            {centrais.map((n) => (
              <li key={n.id} className="flex justify-between">
                <span className="font-mono">{n.id}</span>
                <span className="tabular-nums text-muted">{formatNumber(n.autovetor, 3)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ conhecimento
const COR_TIPO: Record<string, string> = {
  Empresa: "--viz-cinza-1",
  Setor: "--viz-cinza-2",
  Acionista: "--viz-cinza-3",
  Pessoa: "--viz-cinza-4",
  Evento: "--viz-cinza-3",
};
const TAMANHO_TIPO: Record<string, number> = {
  Empresa: 7,
  Setor: 9,
  Acionista: 4,
  Pessoa: 3,
  Evento: 4,
};
const RELACOES: Record<string, string> = {
  PERTENCE_A: "Pertence ao setor",
  ADMINISTRA: "Administra",
  CONTROLA: "Controla",
  PARTICIPA: "Participa (≥ 5%)",
  CO_MENCIONADA_COM: "Citadas juntas",
  MENCIONADA_EM: "Mencionada em evento",
};

function AbaConhecimento({ grafos }: { grafos: Grafos }) {
  const k = grafos.conhecimento;
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ativas, setAtivas] = useState<Set<string>>(new Set(Object.keys(RELACOES)));
  const listaId = useId();

  const porRotulo = useMemo(() => new Map((k?.nos ?? []).map((n) => [n.rotulo, n.id])), [k]);
  const rotulo = useMemo(() => new Map((k?.nos ?? []).map((n) => [n.id, n])), [k]);

  const { nos, arestas } = useMemo(() => {
    if (!k) return { nos: [], arestas: [] };
    const maxGrau = Math.max(...k.nos.map((n) => n.grau), 1);
    return {
      nos: k.nos.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        size: (TAMANHO_TIPO[n.tipo] ?? 3) + 6 * Math.sqrt(n.grau / maxGrau),
        cor: COR_TIPO[n.tipo] ?? "--viz-cinza-4",
        label: n.tipo === "Empresa" && n.ticker ? n.ticker : n.rotulo,
        rotuloSempre: n.tipo === "Empresa" || n.tipo === "Setor",
      })),
      arestas: k.arestas
        .filter((e) => ativas.has(e.relacao))
        .map((e) => ({
          source: e.source,
          target: e.target,
          size: e.relacao === "CO_MENCIONADA_COM" ? 1 + Math.min(e.peso, 3) : 1,
          cor: "--viz-aresta",
        })),
    };
  }, [k, ativas]);

  const ligacoes = useMemo(
    () =>
      k && sel
        ? k.arestas.filter((e) => ativas.has(e.relacao) && (e.source === sel || e.target === sel))
        : [],
    [k, sel, ativas],
  );
  const destaque = useMemo(
    () =>
      sel ? new Set([sel, ...ligacoes.map((e) => (e.source === sel ? e.target : e.source))]) : null,
    [sel, ligacoes],
  );

  if (!k)
    return (
      <p className="text-muted">
        Sem grafo de conhecimento. Rode <code>nicho grafos</code>.
      </p>
    );
  const noSel = sel ? rotulo.get(sel) : undefined;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card aria-labelledby="card-kg">
        <CardHeader>
          <CardTitle id="card-kg">Empresas, pessoas, acionistas, setores e eventos</CardTitle>
          <span className="text-small text-muted">
            {k.nos.length} nós · {k.arestas.length} ligações · CVM (FRE) e notícias
          </span>
        </CardHeader>
        <form
          role="search"
          className="mb-12 flex gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            const id =
              porRotulo.get(busca) ?? k.nos.find((n) => n.ticker === busca.toUpperCase())?.id;
            if (id) setSel(id);
          }}
        >
          <label htmlFor={`${listaId}-busca`} className="sr-only">
            Buscar nó
          </label>
          <input
            id={`${listaId}-busca`}
            list={listaId}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Busque empresa, ticker, pessoa ou acionista"
            className="min-w-0 flex-1 rounded-md border border-(--color-iron-peak) bg-surface-2 px-12 py-6 text-small"
          />
          <datalist id={listaId}>
            {k.nos.map((n) => (
              <option key={n.id} value={n.rotulo} />
            ))}
          </datalist>
          <Button size="sm" type="submit">
            Focar
          </Button>
        </form>
        <SigmaGraph
          nos={nos}
          arestas={arestas}
          destaque={destaque}
          selecionado={sel}
          onSelecionar={setSel}
          label={`Grafo de conhecimento com ${k.nos.length} nós. Selecione um nó pela busca para listar suas ligações ao lado.`}
        />
        <fieldset className="mt-12 flex flex-wrap gap-12 text-small">
          <legend className="sr-only">Tipos de ligação visíveis</legend>
          {Object.entries(RELACOES).map(([r, nome]) => (
            <label key={r} className="flex items-center gap-4">
              <input
                type="checkbox"
                checked={ativas.has(r)}
                onChange={() => {
                  const n = new Set(ativas);
                  if (n.has(r)) n.delete(r);
                  else n.add(r);
                  setAtivas(n);
                }}
                className="accent-(--color-bone)"
              />
              {nome}
            </label>
          ))}
        </fieldset>
      </Card>

      <Card aria-labelledby="card-kg-sel">
        <CardHeader>
          <CardTitle id="card-kg-sel">{noSel ? noSel.tipo : "Ligações"}</CardTitle>
          {noSel?.ticker ? (
            <Link href={`/ativo/${noSel.ticker}`} className="text-small text-link hover:underline">
              Abrir ativo →
            </Link>
          ) : null}
        </CardHeader>
        {noSel ? (
          <>
            <p className="mb-8 text-body font-medium">{noSel.rotulo}</p>
            <ul className="flex max-h-[460px] flex-col gap-6 overflow-y-auto text-small">
              {ligacoes.map((e, idx) => {
                const outro = rotulo.get(e.source === sel ? e.target : e.source);
                return (
                  <li key={idx} className="flex flex-col border-b border-default pb-4">
                    <button
                      type="button"
                      onClick={() => outro && setSel(outro.id)}
                      className="text-left text-primary hover:underline"
                    >
                      {outro?.rotulo}
                    </button>
                    <span className="text-muted">
                      {RELACOES[e.relacao] ?? e.relacao}
                      {e.cargo ? ` · ${e.cargo}` : ""}
                      {e.percentual ? ` · ${formatNumber(e.percentual, 1)}%` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-small text-muted">
            Clique num nó ou use a busca. Pessoas e acionistas vêm do Formulário de Referência da
            CVM (só nome e cargo, já públicos); eventos são as histórias mais relevantes.
          </p>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ choque
function AbaChoque({ grafos }: { grafos: Grafos }) {
  const c = grafos.choque;
  const [semente, setSemente] = useState(
    c?.sementes.find((s) => s.id === "empresa:VALE3")?.id ?? c?.sementes[0]?.id ?? "",
  );
  const id = useId();
  if (!c)
    return (
      <p className="text-muted">
        Sem rankings de choque. Rode <code>nicho grafos</code>.
      </p>
    );
  const ranking: ImpactoChoque[] = c.rankings[semente] ?? [];
  const grupos = ["Empresa", "Setor", "Acionista"] as const;
  const nomeTipo = {
    Empresa: "Empresas",
    Setor: "Setores",
    Acionista: "Acionistas com 2+ empresas",
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card aria-labelledby="card-choque-sel">
        <CardHeader>
          <CardTitle id="card-choque-sel">De onde vem o choque</CardTitle>
        </CardHeader>
        <label htmlFor={id} className="mb-4 block text-label uppercase text-muted">
          Nó de origem
        </label>
        <select
          id={id}
          value={semente}
          onChange={(e) => setSemente(e.target.value)}
          className="w-full rounded-md border border-(--color-iron-peak) bg-surface-2 px-8 py-6 text-small"
        >
          {grupos.map((t) => (
            <optgroup key={t} label={nomeTipo[t]}>
              {c.sementes
                .filter((s) => s.tipo === t)
                .sort((a, b) => a.rotulo.localeCompare(b.rotulo))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.rotulo}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-12 text-small text-muted">
          PageRank personalizado sobre correlações, notícias em comum, controle, participação,
          administradores e setor. Mede{" "}
          <strong className="font-medium text-primary">exposição por conexão</strong>, não prevê
          preço.
        </p>
      </Card>

      <Card aria-labelledby="card-choque-ranking">
        <CardHeader>
          <CardTitle id="card-choque-ranking">Empresas mais expostas</CardTitle>
          <span className="text-small text-muted">100 = a mais exposta</span>
        </CardHeader>
        {ranking.length === 0 ? (
          <p className="text-small text-muted">Este nó não tem ligações suficientes.</p>
        ) : (
          <ol className="flex flex-col">
            {ranking.map((r, idx) => (
              <li
                key={r.id}
                className="grid grid-cols-[24px_minmax(0,1fr)_56px] items-center gap-8 border-b border-default py-8 last:border-0"
              >
                <span className="text-small tabular-nums text-muted">{idx + 1}</span>
                <div className="flex min-w-0 flex-col gap-4">
                  <span className="text-body font-medium">{r.rotulo}</span>
                  <div aria-hidden="true" className="h-4 rounded-sm bg-surface-3">
                    <div className="h-4 rounded-sm bg-primary" style={{ width: `${r.impacto}%` }} />
                  </div>
                  <span className="text-small text-muted">
                    {r.caminho.map((p, j) => (
                      <span key={j}>
                        {j === 0 ? p.de : ""} → <span className="text-primary">{p.motivo}</span>
                        {p.detalhe ? ` (${p.detalhe})` : ""} → {p.para}
                        {j < r.caminho.length - 1 ? " " : ""}
                      </span>
                    ))}
                  </span>
                </div>
                <span className="text-right text-heading-sm font-medium tabular-nums">
                  {formatNumber(r.impacto, 0)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
