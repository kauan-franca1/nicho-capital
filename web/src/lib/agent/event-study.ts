import type { DailyBar } from "@/lib/data/types";

/**
 * Event study com modelo de mercado (mesma especificação de pipeline/nicho/stats/event_study.py):
 * OLS em [−250, −11] pregões, CAR na janela, t com T−2 graus de liberdade e IC pela t de Student.
 * Usado pelo agente para datas que o pipeline não pré-calculou.
 */

export type ResultadoEventStudy = {
  dataEvento: string;
  janela: [number, number];
  alpha: number;
  beta: number;
  nEstimacao: number;
  car: number;
  tStat: number;
  pValor: number;
  icInf: number;
  icSup: number;
  dias: { rel: number; dia: string; ar: number; car: number }[];
};

const px = (b: DailyBar) => b.adjClose ?? b.close;

export function retornosLog(bars: DailyBar[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const a = px(bars[i - 1]);
    const b = px(bars[i]);
    if (a > 0 && b > 0) out.set(bars[i].dia, Math.log(b / a));
  }
  return out;
}

// ------------------------------------------------------------------ t de Student
function lgamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Beta incompleta regularizada I_x(a, b) por frações contínuas (Numerical Recipes). */
function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  const cf = (xx: number, aa: number, bb: number) => {
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa2 = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + aa2 * d;
      d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + aa2 / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      h *= d * c;
      aa2 = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + aa2 * d;
      d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + aa2 / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}

/** P(|T| > |t|) para t de Student com `gl` graus de liberdade. */
export function pBicaudal(t: number, gl: number): number {
  return betaInc(gl / (gl + t * t), gl / 2, 0.5);
}

/** Quantil bicaudal da t (busca por bisseção): t tal que P(|T| > t) = 1 − nível. */
export function tCritico(nivel: number, gl: number): number {
  let lo = 0;
  let hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (pBicaudal(mid, gl) > 1 - nivel) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ estudo
export function eventStudy(
  acao: DailyBar[],
  mercado: DailyBar[],
  dataEvento: string,
  janela: [number, number] = [-1, 1],
  estimacao: [number, number] = [-250, -11],
  minObs = 120,
  nivel = 0.95,
): ResultadoEventStudy | null {
  const ra = retornosLog(acao);
  const rm = retornosLog(mercado);
  const dias = [...ra.keys()].filter((d) => rm.has(d)).sort();
  const pos = dias.findIndex((d) => d >= dataEvento);
  if (pos < 0) return null;
  const [e0, e1] = estimacao;
  const [a, b] = janela;
  if (pos + e0 < 0 || pos + b >= dias.length) return null;

  const est = dias.slice(pos + e0, pos + e1 + 1);
  if (est.length < minObs) return null;
  const y = est.map((d) => ra.get(d)!);
  const x = est.map((d) => rm.get(d)!);
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const gl = est.length - 2;
  const ssr = y.reduce((s, v, i) => s + (v - alpha - beta * x[i]) ** 2, 0);
  const sigma = Math.sqrt(ssr / gl);

  const ev = dias.slice(pos + a, pos + b + 1);
  let acumulado = 0;
  const serie = ev.map((d, k) => {
    const ar = ra.get(d)! - (alpha + beta * rm.get(d)!);
    acumulado += ar;
    return { rel: a + k, dia: d, ar, car: acumulado };
  });
  const se = sigma * Math.sqrt(ev.length);
  const t = acumulado / se;
  const crit = tCritico(nivel, gl);
  return {
    dataEvento: dias[pos],
    janela,
    alpha,
    beta,
    nEstimacao: est.length,
    car: acumulado,
    tStat: t,
    pValor: pBicaudal(t, gl),
    icInf: acumulado - crit * se,
    icSup: acumulado + crit * se,
    dias: serie,
  };
}
