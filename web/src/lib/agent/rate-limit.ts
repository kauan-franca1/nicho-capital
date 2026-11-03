/**
 * Limite de requisições por IP (janela deslizante, em memória) para proteger a cota gratuita dos
 * LLMs. Em serverless o estado é por instância: é uma proteção básica, não um WAF.
 */
export class LimitePorIp {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Devolve 0 se liberado; senão, quantos segundos esperar. */
  consumir(ip: string): number {
    const t = this.agora();
    const recentes = (this.hits.get(ip) ?? []).filter((x) => t - x < this.janelaMs);
    if (recentes.length >= this.maximo) {
      this.hits.set(ip, recentes);
      return Math.ceil((this.janelaMs - (t - recentes[0])) / 1000);
    }
    recentes.push(t);
    this.hits.set(ip, recentes);
    if (this.hits.size > 5000) this.hits.clear(); // evita crescer sem limite
    return 0;
  }
}

export const MAX_PERGUNTA = 500;
