import { type BenchTask, defineTask } from "../../core/types.ts";
import { type RefreshKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

export function task(): BenchTask {
  return defineTask<RefreshKey>({
    id: "knowledge-refresh-stale",
    difficulty: "easy",
    family: "knowledge",
    origin: "research",
    evidence:
      "Garry Tan's Own Your Intelligence talk (14:48 onward): organizational memory that is kept current rather than accumulating stale facts.",
    sources: ["https://www.youtube.com/watch?v=eRrc1pUY5oU&t=888s"],
    outputs: ["output/handbook.md"],
    generate,
    prompt: () =>
      "knowledge/handbook.md has fallen behind the announcements in updates/. Write the corrected handbook to output/handbook.md as of the date the announcement files state: apply every change that is already effective, in stamp order across all the files (a later announcement can undo an earlier one), resolve section names through knowledge/aliases.md, keep every other section byte-for-byte identical, and keep the section order. Write a script.",
    verify,
  });
}
