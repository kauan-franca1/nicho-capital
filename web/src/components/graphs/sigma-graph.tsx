"use client";

import Graph from "graphology";
import { useEffect, useLayoutEffect, useRef } from "react";
import Sigma from "sigma";

/**
 * Wrapper do Sigma.js (WebGL) + graphology.
 * Cores chegam como NOMES de token (ex.: "--viz-cinza-1") e são resolvidas aqui (ADR 0004).
 * Mudanças de posição (snapshot novo) são animadas por interpolação.
 */

export type NoVisual = {
  id: string;
  x: number;
  y: number;
  size: number;
  cor: string; // nome do token
  label: string;
  rotuloSempre?: boolean;
};

export type ArestaVisual = { source: string; target: string; size: number; cor: string };

const token = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || n;

export function SigmaGraph({
  nos,
  arestas,
  destaque,
  selecionado,
  onSelecionar,
  label,
  height = 520,
}: {
  nos: NoVisual[];
  arestas: ArestaVisual[];
  /** Se definido, só estes nós (e as arestas entre eles) ficam em destaque; o resto esmaece. */
  destaque?: Set<string> | null;
  selecionado?: string | null;
  onSelecionar?: (id: string | null) => void;
  label: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const grafo = useRef(new Graph({ multi: false, type: "undirected" }));
  const estado = useRef({ destaque, selecionado });
  const onSel = useRef(onSelecionar);
  // Os reducers do Sigma leem o estado atual por refs, atualizadas depois de cada render.
  useLayoutEffect(() => {
    estado.current = { destaque, selecionado };
    onSel.current = onSelecionar;
    sigma.current?.refresh();
  }, [destaque, selecionado, onSelecionar]);

  // Cria o renderizador uma vez.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = new Sigma(grafo.current, el, {
      labelFont: token("--font-family-sans"),
      labelSize: 11,
      labelWeight: "500",
      labelColor: { color: token("--text-primary") },
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: token("--viz-aresta"),
      zIndex: true,
      nodeReducer: (n, d) => {
        const { destaque: dq, selecionado: sel } = estado.current;
        const out: Record<string, unknown> = { ...d };
        if (n === sel) {
          out.color = token("--color-voltage-blue");
          out.highlighted = true;
          out.forceLabel = true;
          out.zIndex = 2;
        } else if (dq && !dq.has(n)) {
          out.color = token("--viz-esmaecido");
          out.label = "";
          out.zIndex = 0;
        } else if (dq) {
          out.forceLabel = true;
          out.zIndex = 1;
        }
        return out;
      },
      edgeReducer: (e, d) => {
        const { destaque: dq } = estado.current;
        if (!dq) return d;
        const [a, b] = grafo.current.extremities(e);
        return dq.has(a) && dq.has(b)
          ? { ...d, color: token("--viz-aresta-forte"), zIndex: 1 }
          : { ...d, color: token("--viz-esmaecido"), zIndex: 0 };
      },
    });
    s.on("clickNode", ({ node }) => onSel.current?.(node));
    s.on("clickStage", () => onSel.current?.(null));
    s.on("enterNode", () => {
      el.style.cursor = "pointer";
    });
    s.on("leaveNode", () => {
      el.style.cursor = "default";
    });
    sigma.current = s;
    return () => {
      s.kill();
      sigma.current = null;
    };
  }, []);

  // Sincroniza dados; posições de nós já existentes são interpoladas.
  useEffect(() => {
    const g = grafo.current;
    const ids = new Set(nos.map((n) => n.id));
    g.forEachNode((n) => {
      if (!ids.has(n)) g.dropNode(n);
    });
    const origem = new Map<string, { x: number; y: number }>();
    for (const n of nos) {
      const attrs = {
        size: n.size,
        color: token(n.cor),
        label: n.label,
        forceLabel: !!n.rotuloSempre,
      };
      if (g.hasNode(n.id)) {
        origem.set(n.id, { x: g.getNodeAttribute(n.id, "x"), y: g.getNodeAttribute(n.id, "y") });
        g.mergeNodeAttributes(n.id, attrs);
      } else {
        g.addNode(n.id, { ...attrs, x: n.x, y: n.y });
      }
    }
    g.clearEdges();
    for (const e of arestas) {
      if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
        g.addEdge(e.source, e.target, { size: e.size, color: token(e.cor) });
      }
    }
    if (origem.size === 0) return;
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const destino = new Map(nos.map((n) => [n.id, n]));
    const inicio = performance.now();
    const duracao = reduzido ? 0 : 500;
    let raf = 0;
    const passo = (agora: number) => {
      const t = duracao === 0 ? 1 : Math.min((agora - inicio) / duracao, 1);
      const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out
      for (const [id, o] of origem) {
        const d = destino.get(id)!;
        g.mergeNodeAttributes(id, { x: o.x + (d.x - o.x) * k, y: o.y + (d.y - o.y) * k });
      }
      if (t < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [nos, arestas]);

  return <div ref={ref} role="img" aria-label={label} style={{ height }} className="w-full" />;
}
