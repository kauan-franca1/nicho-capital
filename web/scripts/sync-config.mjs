// Converte a config compartilhada com o pipeline (config/*.yaml) em JSON tipável pelo web.
// Roda antes de dev, build e test. A saída fica em src/generated/ (ignorada pelo git).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const destino = join(here, "..", "src", "generated");
mkdirSync(destino, { recursive: true });
const salvar = (nome, dados) =>
  writeFileSync(join(destino, nome), JSON.stringify(dados, null, 2) + "\n");

const universe = parse(readFileSync(join(root, "config", "universe.yaml"), "utf8"));
salvar("universe.json", {
  indice: universe.indice,
  setores: universe.setores,
  ativos: universe.ativos.map(({ ticker, nome, setor, apelidos }) => ({
    ticker,
    nome,
    setor,
    apelidos,
  })),
});

// Cadeia de LLMs do agente (mesmo config/llm.yaml do pipeline). Sem chaves: só nomes de variáveis.
const llm = parse(readFileSync(join(root, "config", "llm.yaml"), "utf8"));
salvar("llm.json", {
  cadeia: llm.cadeia,
  provedores: Object.fromEntries(
    Object.entries(llm.provedores).map(([nome, p]) => [
      nome,
      {
        modelo: p.modelo_agente,
        envChave: p.env_chave ?? null,
        envUrl: p.env_url ?? null,
        rpm: p.cota.rpm,
        rpd: p.cota.rpd,
      },
    ]),
  ),
});

console.log(`sync-config: ${universe.ativos.length} ativos, cadeia LLM ${llm.cadeia.join(" → ")}`);
