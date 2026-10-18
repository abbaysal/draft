/** Numerical helpers: seeded RNG, normal CDF/PDF, summary statistics. */

/** mulberry32 — small, fast, seedable PRNG (deterministic across platforms). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}

/**
 * Standard normal sample (Marsaglia polar method). The spare deviate is cached per
 * RNG function so each RNG stream stays deterministic and reproducible.
 */
type SpareRng = (() => number) & { _spare?: number };
export function normal(rng: () => number): number {
  const r = rng as SpareRng;
  if (r._spare !== undefined) {
    const s0 = r._spare;
    r._spare = undefined;
    return s0;
  }
  let u: number, v: number, s: number;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  r._spare = v * m;
  return u * m;
}

/**
 * Standard normal CDF via the Abramowitz–Stegun 7.1.26 erfc approximation
 * (|err| < 1.5e-7). Written as an exact complement so Φ(x) + Φ(−x) = 1 and Φ(0) = ½.
 */
export function normCdf(x: number): number {
  if (x === 0) return 0.5;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const tail = 0.5 * ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x > 0 ? 1 - tail : tail;
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function sd(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Distribution of the number of successes for independent Bernoulli(p_i) (Poisson-binomial). */
export function poissonBinomial(ps: number[]): number[] {
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

/** Wilson-style standard error of a proportion. */
export function propSe(p: number, n: number): number {
  return n > 0 ? Math.sqrt(Math.max(p * (1 - p), 1e-9) / n) : 1;
}
