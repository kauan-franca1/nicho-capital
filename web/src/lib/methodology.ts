import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import katex from "katex";
import { Marked, Renderer, type Tokens } from "marked";

import { semAcento } from "@/lib/agent/entities";

/**
 * A página /metodologia renderiza os próprios docs/metodologia-*.md do repositório (fonte única:
 * o que está documentado é o que aparece). Fórmulas em $...$ e $$...$$ viram KaTeX no servidor.
 * O conteúdo é do repositório, não de usuário: por isso é seguro injetar o HTML gerado.
 */

export const DOCUMENTOS = [
  { arquivo: "metodologia-estatistica.md", id: "estatistica" },
  { arquivo: "metodologia-noticias.md", id: "noticias" },
  { arquivo: "metodologia-grafos.md", id: "grafos" },
  { arquivo: "metodologia-agente.md", id: "agente" },
] as const;

export type Secao = { id: string; titulo: string; nivel: number };
export type DocRenderizado = { id: string; titulo: string; html: string; secoes: Secao[] };

export function docsDir(): string {
  const c = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "docs"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "docs"),
  ];
  return (
    c.find((d) => existsSync(path.join(/* turbopackIgnore: true */ d, DOCUMENTOS[0].arquivo))) ??
    c[0]
  );
}

export const slug = (s: string) =>
  semAcento(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Troca as fórmulas por marcadores antes do markdown e devolve o HTML do KaTeX de cada uma. */
export function extrairFormulas(md: string): { texto: string; formulas: string[] } {
  const formulas: string[] = [];
  const guardar = (tex: string, bloco: boolean) => {
    formulas.push(
      katex.renderToString(tex.trim(), {
        displayMode: bloco,
        throwOnError: false,
        output: "htmlAndMathml",
      }),
    );
    return `KATEX${formulas.length - 1}FIM`;
  };
  const texto = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => guardar(tex, true))
    .replace(/(?<![\\$\w])\$([^$\n]+?)\$(?!\w)/g, (_, tex: string) => guardar(tex, false));
  return { texto, formulas };
}

export function renderizar(md: string, prefixo: string): DocRenderizado {
  const { texto, formulas } = extrairFormulas(md);
  const secoes: Secao[] = [];
  let titulo = prefixo;
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const texto = this.parser.parseInline(tokens);
        const limpo = texto.replace(/<[^>]+>/g, "");
        if (depth === 1) {
          titulo = limpo;
          return ""; // o título do documento vira o h2 da página
        }
        const id = `${prefixo}-${slug(limpo)}`;
        secoes.push({ id, titulo: limpo, nivel: depth });
        // Rebaixa um nível: h1 da página é "Metodologia", h2 é o documento.
        const n = Math.min(depth + 1, 6);
        return `<h${n} id="${id}">${texto}</h${n}>\n`;
      },
      link({ href, tokens }) {
        const texto = this.parser.parseInline(tokens);
        const externo = /^https?:/.test(href);
        // Links relativos para outros docs do repositório não existem no app: viram texto.
        if (!externo && !href.startsWith("#")) return texto;
        return externo
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${texto}<span class="sr-only"> (abre em nova aba)</span></a>`
          : `<a href="${href}">${texto}</a>`;
      },
      table(token: Tokens.Table): string {
        // Tabelas largas rolam dentro do próprio contêiner, não a página.
        const html = Renderer.prototype.table.call(this, token);
        return `<div class="tabela">${html}</div>`;
      },
    },
  });
  const html = (marked.parse(texto, { async: false }) as string).replace(
    /KATEX(\d+)FIM/g,
    (_, i: string) => formulas[Number(i)],
  );
  return { id: prefixo, titulo, html, secoes };
}

export async function carregarMetodologia(): Promise<DocRenderizado[]> {
  const dir = docsDir();
  return Promise.all(
    DOCUMENTOS.map(async (d) =>
      renderizar(
        await readFile(path.join(/* turbopackIgnore: true */ dir, d.arquivo), "utf-8"),
        d.id,
      ),
    ),
  );
}
