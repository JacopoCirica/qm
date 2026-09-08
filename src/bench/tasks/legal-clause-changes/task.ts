import { type BenchTask, defineTask } from "../../core/types.ts";
import { type RedlineKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

export function task(): BenchTask {
  return defineTask<RedlineKey>({
    id: "legal-clause-changes",
    difficulty: "medium",
    family: "legal",
    origin: "observed",
    evidence:
      "Proposed legal workflow for qm: diff a counterparty's redline against the standard form and route material changes to a partner. Not a workflow Garry listed.",
    sources: ["https://qm.ycombinator.com/", "https://github.com/yc-software/qm"],
    outputs: ["output/clause-review.json"],
    generate,
    prompt: () =>
      'Compare each redline in legal/redlines/ against legal/template-safe.md clause by clause, following legal/review-policy.md for how to identify clauses and what needs a partner. Write output/clause-review.json as a JSON object keyed by redline file name, each value {"changed": [template clause ids whose substance differs, plus removed clauses and NEW-<n> for added ones], "needs_review": [the subset the policy sends to a partner]}. Write a script.',
    verify,
  });
}
