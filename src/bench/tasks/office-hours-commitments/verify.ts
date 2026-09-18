import { asArray, asRecord, f1, parseJson, str } from "../../core/text.ts";
import type { Check, Outputs } from "../../core/types.ts";
import type { CommitmentsKey } from "./generate.ts";

/**
 * Checks the owner-plus-date set after corrections, that each task is described, the open set,
 * the overdue flags, and that both files have exactly the expected number of rows so padding or
 * an extra extracted line fails.
 */
export async function verify(outputs: Outputs, key: CommitmentsKey): Promise<Check[]> {
  const rows = asArray(parseJson(await outputs.read("output/commitments.json"))).map(asRecord);
  const openRows = asArray(parseJson(await outputs.read("output/open.json"))).map(asRecord);
  const pair = (c: { owner: string; due: string }): string => `${c.owner.toLowerCase()}|${c.due}`;
  const taskHit =
    key.afterCorrections.filter((c) =>
      rows.some(
        (g) => str(g.due) === c.due && str(g.task).toLowerCase().includes(c.task.split(" ").slice(-2).join(" ")),
      ),
    ).length / key.afterCorrections.length;
  const overdueRight =
    key.open.filter((c) => openRows.some((g) => str(g.due) === c.due && g.overdue === c.overdue)).length /
    key.open.length;
  return [
    {
      id: "commitments-after-corrections",
      score: f1(
        key.afterCorrections.map(pair),
        rows.map((g) => pair({ owner: str(g.owner), due: str(g.due) })),
      ),
    },
    { id: "commitment-tasks", score: taskHit },
    {
      id: "open-set",
      score: f1(
        key.open.map(pair),
        openRows.map((g) => pair({ owner: str(g.owner), due: str(g.due) })),
      ),
    },
    { id: "overdue-flags", score: openRows.length === 0 ? 0 : overdueRight },
    {
      id: "counts",
      score: rows.length === key.afterCorrections.length && openRows.length === key.open.length ? 1 : 0,
    },
  ];
}
