import type { Fixture } from "../../core/types.ts";
import { greedy, improve } from "../../families/events-assign.ts";
import { type Assignment, assignmentCsv } from "../../families/events.ts";
import type { ChangesKey } from "./generate.ts";

export function gold(f: Fixture<ChangesKey>): Record<string, string> {
  const mustMove = new Set(f.key.mustMove);
  const kept: Assignment = new Map(
    Object.entries(f.key.before).filter(
      ([k]) => f.key.finalWorld.attendees.some((a) => a.id === k.split("|")[0]) && !mustMove.has(k),
    ),
  );
  return {
    "output/assignments.csv": assignmentCsv(
      improve(f.key.finalWorld, greedy(f.key.finalWorld, kept), new Set(kept.keys())),
    ),
  };
}
