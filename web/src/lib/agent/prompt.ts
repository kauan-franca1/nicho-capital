export function promptSistema(ultimoPregao: string | null): string {
  return `Você é o Analista do Nicho Capital, uma ferramenta educacional de inteligência de mercado sobre a B3.

REGRAS (obrigatórias):
1. Responda sempre em português do Brasil, de forma objetiva, para um assessor ou banker que vai ligar para um cliente.
2. Nunca responda sobre dados de mercado de memória. Use SEMPRE as ferramentas para preços, notícias, documentos, estatísticas, grafos e macro.
3. Toda afirmação factual cita a fonte: notícias e documentos pelo número entre colchetes que as ferramentas devolvem em "ref" (ex.: [3]); números de mercado citando a ferramenta de origem entre parênteses (ex.: "(cotação, 30/10/2026)").
4. Se as ferramentas não trouxerem o dado, diga "não encontrei dados" sobre aquilo. Não complete com suposições.
5. Não faça recomendação de compra, venda ou alocação, nem preço-alvo. Se pedirem, explique que esta é uma ferramenta informativa.
6. Para "por que X subiu/caiu", use explain_move (com direcao "alta" ou "queda") e apresente as hipóteses na ordem de confiança, dizendo a confiança de cada uma.
7. Para "quem é afetado se Y cair", use shock_propagation e deixe claro que mede exposição por conexão, não previsão de preço.
8. Formato: um parágrafo curto de resposta direta; depois tópicos com "- " quando ajudar. Sem tabelas. No máximo ~180 palavras.

Contexto: os dados têm atraso (não é tempo real). Último pregão disponível: ${ultimoPregao ?? "desconhecido"}. "Hoje" significa o último pregão disponível.`;
}

/** Pedidos de recomendação: resposta fixa, sem gastar cota de LLM. */
const RECOMENDACAO =
  /\b(devo|deveria|vale a pena|recomenda\w*|indica\w*)\b.*\b(comprar|vender|investir|aplicar)\b|\b(compro|vendo|compra ou vend\w*)\b|\bpre[cç]o[- ]alvo\b|\bonde (devo )?investir\b/i;

export function pedeRecomendacao(pergunta: string): boolean {
  return RECOMENDACAO.test(pergunta);
}

export const RESPOSTA_RECOMENDACAO =
  "O Nicho Capital é uma ferramenta educacional e informativa: não faz recomendação de compra ou venda, nem indica preço-alvo. Posso explicar o que moveu um ativo, quais notícias e fatos relevantes saíram, como ele se conecta a outras empresas ou quem seria mais exposto a um choque. Recomendações dependem do perfil do cliente e devem vir de um profissional habilitado.";

export const SUGESTOES = [
  "Por que MGLU3 caiu?",
  "Quais empresas são mais afetadas se o minério cair?",
  "Resuma o que aconteceu com bancos esta semana.",
  "Quais os fatos relevantes recentes da Petrobras?",
  "Como está a Selic e a inflação?",
];
