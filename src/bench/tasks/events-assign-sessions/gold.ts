import type { Fixture } from "../../core/types.ts";
import { greedy, improve } from "../../families/events-assign.ts";
import { assignmentCsv } from "../../families/events.ts";
import type { AssignKey } from "./generate.ts";

export function gold(f: Fixture<AssignKey>): Record<string, string> {
  return { "output/assignments.csv": assignmentCsv(improve(f.key.world, greedy(f.key.world))) };
}
