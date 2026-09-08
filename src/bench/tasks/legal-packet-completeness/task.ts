import { type BenchTask, defineTask } from "../../core/types.ts";
import { type PacketKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

export function task(): BenchTask {
  return defineTask<PacketKey>({
    id: "legal-packet-completeness",
    difficulty: "easy",
    family: "legal",
    origin: "observed",
    evidence:
      "Proposed legal workflow for qm: verify closing packets against a checklist before signature. Not a workflow Garry listed.",
    sources: ["https://qm.ycombinator.com/", "https://github.com/yc-software/qm"],
    outputs: ["output/completeness.json"],
    generate,
    prompt: () =>
      'Check every packet under legal/packets/ against legal/checklist.md, using legal/companies.csv for each packet\'s round type. Write output/completeness.json as a JSON object keyed by packet directory name, each value {"complete": true|false, "missing": [canonical document names from the checklist that are absent]}. Write a script.',
    verify,
  });
}
