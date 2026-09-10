import type { Fixture } from "../../core/types.ts";
import { assignmentCsv } from "../../families/events.ts";
import { type AssignKey, solve } from "./generate.ts";

export function gold(f: Fixture<AssignKey>): Record<string, string> {
  return { "output/assignments.csv": assignmentCsv(solve(f.key)) };
}
