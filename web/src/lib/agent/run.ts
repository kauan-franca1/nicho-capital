import { getHistorias } from "@/lib/data/source";
import { universe } from "@/lib/universe";

import {
  planejar,
  TEXTO_AJUDA,
  textoChoque,
  textoDocumentos,
  textoExplicacao,
  textoMacro,
  textoNoticias,
  textoSetor,
} from "./deterministic";
import {
  chatStream,
  type ChamadaFerramenta,
  type Mensagem,
  type Provedor,
  ProvedorIndisponivel,
  provedoresDisponiveis,
} from "./llm";
import { pedeRecomendacao, promptSistema, RESPOSTA_RECOMENDACAO } from "./prompt";
import { esquemasOpenAI, FERRAMENTAS, type Fonte, RegistroFontes, ultimoPregao } from "./tools";

export type EventoAgente =
  | {
      tipo: "modo";
      modo: "llm" | "regras" | "guarda";
      provedor?: string;
      modelo?: string;
      motivo?: string;
    }
  | {
      tipo: "passo";
      id: number;
      ferramenta: string;
      texto: string;
      status: "rodando" | "ok" | "erro";
      args?: unknown;
      resumo?: string;
      ms?: number;
    }
  | { tipo: "texto"; delta: string }
  | { tipo: "fontes"; fontes: Fonte[] }
  | { tipo: "fim" };

const MAX_VOLTAS = 6;
const MAX_RESULTADO = 7000; // caracteres por resultado de ferramenta enviado ao LLM

/** Executa uma ferramenta emitindo o passo (rodando → ok/erro) para a interface. */
async function* executar(
  nome: string,
  args: Record<string, unknown>,
  id: number,
  fontes: RegistroFontes,
  saida: { dados?: unknown },
): AsyncGenerator<EventoAgente> {
  const f = FERRAMENTAS[nome];
  if (!f) {
    saida.dados = { erro: `ferramenta desconhecida: ${nome}` };
    yield {
      tipo: "passo",
      id,
      ferramenta: nome,
      texto: nome,
      status: "erro",
      args,
      resumo: "ferramenta desconhecida",
    };
    return;
  }
  yield { tipo: "passo", id, ferramenta: nome, texto: f.passo, status: "rodando", args };
  const t0 = performance.now();
  try {
    const r = await f.executar(args, fontes);
    saida.dados = r.dados;
    yield {
      tipo: "passo",
      id,
      ferramenta: nome,
      texto: f.passo,
      status: "ok",
      args,
      resumo: r.resumo,
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    saida.dados = { erro: (e as Error).message };
    yield {
      tipo: "passo",
      id,
      ferramenta: nome,
      texto: f.passo,
      status: "erro",
      args,
      resumo: (e as Error).message,
      ms: Math.round(performance.now() - t0),
    };
  }
}

/** Texto emitido em pedaços (modo sem LLM): mantém a mesma interface de streaming. */
function* emitir(texto: string): Generator<EventoAgente> {
  for (const parte of texto.match(/[^\n]*\n?/g) ?? [texto])
    if (parte) yield { tipo: "texto", delta: parte };
}

// ------------------------------------------------------------------ modo sem LLM
export async function* modoRegras(
  pergunta: string,
  fontes: RegistroFontes,
): AsyncGenerator<EventoAgente> {
  const plano = planejar(pergunta);
  let id = 0;
  const rodar = async function* (
    nome: string,
    args: Record<string, unknown>,
    saida: { dados?: unknown },
  ) {
    yield* executar(nome, args, ++id, fontes, saida);
  };
  const s: { dados?: unknown } = {};
  switch (plano.intencao) {
    case "explicar": {
      yield* rodar(
        "explain_move",
        { ticker: plano.ticker, ...(plano.direcao ? { direcao: plano.direcao } : {}) },
        s,
      );
      const d = s.dados as Parameters<typeof textoExplicacao>[0] & { erro?: string };
      yield* emitir(d.erro ? `Não encontrei dados: ${d.erro}.` : textoExplicacao(d));
      break;
    }
    case "choque": {
      yield* rodar("shock_propagation", { no: plano.no }, s);
      const d = s.dados as Parameters<typeof textoChoque>[0] & { erro?: string };
      yield* emitir(
        d.erro
          ? "Não encontrei esse ponto de origem no grafo. Tente uma empresa, um setor ou fatores como minério, petróleo ou juros."
          : textoChoque(d),
      );
      break;
    }
    case "setor": {
      const ativos = universe.ativos.filter((a) => a.setor === plano.setor);
      const retornos: { ticker: string; retorno_pct: number }[] = [];
      let desde = "";
      let ate = "";
      const periodo = plano.dias <= 1 ? "1d" : plano.dias <= 5 ? "1s" : "1m";
      for (const a of ativos) {
        const h: { dados?: unknown } = {};
        yield* rodar("get_history", { ticker: a.ticker, periodo }, h);
        const d = h.dados as { retorno_pct?: number; inicio?: string; fim?: string };
        if (d.retorno_pct !== undefined && d.inicio && d.fim) {
          retornos.push({ ticker: a.ticker, retorno_pct: d.retorno_pct });
          desde = d.inicio;
          ate = d.fim;
        }
      }
      const n: { dados?: unknown } = {};
      yield* rodar("search_news", { query: universe.setores[plano.setor], desde }, n);
      const hs = await getHistorias();
      const doSetor = new Set(ativos.map((a) => a.ticker));
      const relevantes = hs
        .filter((h) => h.ultimaEm.slice(0, 10) >= desde && h.tickers.some((t) => doSetor.has(t)))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((h) => ({
          titulo: h.titulo,
          ref: h.itens.slice(0, 2).map((i) =>
            fontes.adicionar({
              titulo: i.titulo,
              link: i.link,
              origem: i.fonte,
              data: i.publicadoEm,
            }),
          ),
        }));
      yield* emitir(
        textoSetor({
          setor: plano.setor,
          dias: plano.dias,
          desde,
          ate,
          retornos,
          noticias: relevantes,
        }),
      );
      break;
    }
    case "documentos": {
      yield* rodar("get_filings", { ticker: plano.ticker }, s);
      yield* emitir(textoDocumentos(s.dados as Parameters<typeof textoDocumentos>[0]));
      break;
    }
    case "macro": {
      yield* rodar("get_macro", {}, s);
      yield* emitir(textoMacro(s.dados as Parameters<typeof textoMacro>[0]));
      break;
    }
    case "noticias": {
      yield* rodar("search_news", { query: plano.consulta, ticker: plano.ticker ?? undefined }, s);
      yield* emitir(textoNoticias(s.dados as Parameters<typeof textoNoticias>[0], plano.consulta));
      break;
    }
    default:
      yield* emitir(TEXTO_AJUDA);
  }
}

// ------------------------------------------------------------------ modo LLM
async function* modoLLM(
  pergunta: string,
  provedores: Provedor[],
  fontes: RegistroFontes,
): AsyncGenerator<EventoAgente, boolean> {
  const mensagens: Mensagem[] = [
    { role: "system", content: promptSistema(await ultimoPregao()) },
    { role: "user", content: pergunta },
  ];
  const ferramentas = esquemasOpenAI();
  let id = 0;
  let idx = 0;
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    let chamadas: ChamadaFerramenta[] = [];
    let texto = "";
    for (;;) {
      const p = provedores[idx];
      if (!p) return false; // todos falharam: quem chamou cai para o modo sem LLM
      try {
        for await (const ev of chatStream(p, mensagens, ferramentas, {
          exigirFerramenta: volta === 0,
        })) {
          if (ev.tipo === "texto") {
            texto += ev.delta;
            yield { tipo: "texto", delta: ev.delta };
          } else chamadas = ev.chamadas;
        }
        break;
      } catch (e) {
        if (!(e instanceof ProvedorIndisponivel) || texto) throw e;
        idx++;
        const prox = provedores[idx];
        if (prox)
          yield {
            tipo: "modo",
            modo: "llm",
            provedor: prox.nome,
            modelo: prox.modelo,
            motivo: `${p.nome} indisponível`,
          };
      }
    }
    if (!chamadas.length) return true; // resposta final já transmitida
    mensagens.push({ role: "assistant", content: texto || null, tool_calls: chamadas });
    for (const c of chamadas) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        // argumentos inválidos: a ferramenta responde com erro e o modelo corrige
      }
      const s: { dados?: unknown } = {};
      yield* executar(c.function.name, args, ++id, fontes, s);
      mensagens.push({
        role: "tool",
        tool_call_id: c.id,
        content: JSON.stringify(s.dados).slice(0, MAX_RESULTADO),
      });
    }
  }
  yield { tipo: "texto", delta: "\n\nNão consegui concluir a análise no limite de etapas." };
  return true;
}

// ------------------------------------------------------------------ entrada
export async function* rodarAgente(
  pergunta: string,
  opts: { provedores?: Provedor[] } = {},
): AsyncGenerator<EventoAgente> {
  const fontes = new RegistroFontes();
  if (pedeRecomendacao(pergunta)) {
    yield { tipo: "modo", modo: "guarda" };
    yield* emitir(RESPOSTA_RECOMENDACAO);
    yield { tipo: "fim" };
    return;
  }
  const provedores = opts.provedores ?? (await provedoresDisponiveis());
  let concluiu = false;
  if (provedores.length) {
    yield { tipo: "modo", modo: "llm", provedor: provedores[0].nome, modelo: provedores[0].modelo };
    try {
      concluiu = yield* modoLLM(pergunta, provedores, fontes);
    } catch (e) {
      yield {
        tipo: "texto",
        delta: `\n\n(O provedor falhou no meio da resposta: ${(e as Error).message}.)`,
      };
      concluiu = true;
    }
  }
  if (!concluiu) {
    yield {
      tipo: "modo",
      modo: "regras",
      motivo: provedores.length
        ? "todos os provedores de LLM falharam"
        : "nenhum LLM configurado (sem chave e sem Ollama)",
    };
    yield* modoRegras(pergunta, fontes);
  }
  yield { tipo: "fontes", fontes: fontes.lista() };
  yield { tipo: "fim" };
}
