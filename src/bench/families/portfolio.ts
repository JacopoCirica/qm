import { type Rng } from "../core/rng.ts";
import { COMPANY_WORDS } from "../core/world.ts";

/** n distinct company names from the shared word pool, adding a suffix on collisions. */
export function companyNames(r: Rng, n: number): string[] {
  const names = new Set<string>();
  while (names.size < n) {
    const base = r.pick(COMPANY_WORDS);
    names.add(names.has(base) ? `${base} ${r.pick(["Labs", "Systems", "Health", "Robotics", "Bio"])}` : base);
  }
  return [...names];
}

/** Lower-case slug used as the stable record id across portfolio files. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
