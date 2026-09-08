import { type BenchTask, defineTask } from "../../core/types.ts";
import { type IntroKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

export function task(): BenchTask {
  return defineTask<IntroKey>({
    id: "network-draft-intro",
    difficulty: "medium",
    family: "network",
    origin: "observed",
    evidence:
      "Proposed network workflow for qm: draft double opt-in introductions that follow the firm's intro policy. Not a workflow Garry listed.",
    sources: ["https://qm.ycombinator.com/", "https://github.com/yc-software/qm"],
    outputs: ["output/intros.json"],
    generate,
    prompt: () =>
      'inbox/request.md asks for opt-in emails to several people. Use profiles/ for context and follow policy/intro-policy.md exactly. Write output/intros.json as a JSON array with one entry per person in the request, in order: {"to", "subject", "body"} for an email, or {"to", "skipped": true, "reason"} when policy says not to write one.',
    verify,
  });
}
