/**
 * mulberry32, a seeded 32-bit PRNG. Math.random cannot be seeded and every case must regenerate byte
 * for byte from its number, so the bench carries its own generator. The constant and shifts are the
 * reference algorithm.
 */
function createRng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The random helpers every generator draws from. All randomness in a fixture must come through one of
 * these so a case is fully determined by its seed.
 */
export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  sample<T>(items: readonly T[], n: number): T[];
  chance(p: number): boolean;
}

/**
 * Builds an Rng from a seed. Generators mix a task-specific constant into the seed so two tasks never
 * see the same stream.
 */
export function rng(seed: number): Rng {
  const next = createRng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return {
    next,
    int,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    shuffle,
    sample: (items, n) => shuffle(items).slice(0, n),
    chance: (p) => next() < p,
  };
}
