import type { Check, Outputs } from "../../core/types.ts";
import { constraintChecks } from "../../families/events-assign.ts";
import { readAssignments } from "../../families/events.ts";
import type { AssignKey } from "./generate.ts";

export async function verify(outputs: Outputs, key: AssignKey): Promise<Check[]> {
  const { assign, rows } = readAssignments(await outputs.read("output/assignments.csv"));
  return constraintChecks(key.world, assign, rows, key.baselineTop2);
}
