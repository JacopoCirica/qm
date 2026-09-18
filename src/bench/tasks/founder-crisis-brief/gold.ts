import type { Fixture } from "../../core/types.ts";
import type { CrisisKey } from "./generate.ts";

/**
 * Reference brief built straight from the key: corrected runway, newest-note MRR (or null plus
 * both paths when the case plants a conflict), every matching precedent, and generic next steps.
 */
export function gold(f: Fixture<CrisisKey>): Record<string, string> {
  const k = f.key;
  return {
    "output/brief.json": JSON.stringify({
      issues: k.issues,
      runway_months: k.numbers.runwayMonths,
      latest_mrr: k.conflictPath === null ? k.latestMrr : null,
      conflicts: k.conflictPath === null ? [] : [k.latestNotePath, k.conflictPath],
      precedents: k.precedents,
      sources: [
        "inbox/thread.md",
        k.latestNotePath,
        "precedents/INDEX.md",
        ...k.precedents.map((p) => `precedents/${p}.md`),
      ],
      next_steps: [
        "Call the founder tomorrow",
        "Separate the problems and assign an owner to each",
        "Open a bridge conversation with seed investors",
      ],
    }),
  };
}
