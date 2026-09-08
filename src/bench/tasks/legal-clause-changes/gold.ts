import type { Fixture } from "../../core/types.ts";
import type { RedlineKey } from "./generate.ts";

export function gold(f: Fixture<RedlineKey>): Record<string, string> {
  const out: Record<string, { changed: string[]; needs_review: string[] }> = {};
  for (const [name, v] of Object.entries(f.key.redlines))
    out[name] = { changed: v.changed, needs_review: v.needsReview };
  return { "output/clause-review.json": JSON.stringify(out) };
}
