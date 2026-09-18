import type { Check, Outputs } from "../../core/types.ts";
import type { RefreshKey } from "./generate.ts";

/** Scores changes applied, untouched sections byte-identical, and section order preserved. */
export async function verify(outputs: Outputs, key: RefreshKey): Promise<Check[]> {
  const text = (await outputs.read("output/handbook.md")) ?? "";
  const sections = new Map<string, string>();
  for (const m of text.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |\s*$)/gm)) sections.set(m[1]!.trim(), m[2]!.trim());
  const changedTitles = Object.keys(key.changed);
  const updated = changedTitles.filter((t) => {
    const body = sections.get(t) ?? "";
    return body.includes(key.changed[t]!.to) && !body.includes(key.changed[t]!.from);
  }).length;
  const identical = key.untouchedTitles.filter(
    (t) => sections.get(t) === key.original.find((s) => s.title === t)!.body,
  ).length;
  const order = key.original.map((s) => s.title);
  const gotOrder = [...sections.keys()].filter((t) => order.includes(t));
  return [
    { id: "effective-changes-applied", score: updated / changedTitles.length },
    {
      id: "future-and-reverted-left-alone",
      score: sections.size === 0 ? 0 : identical / key.untouchedTitles.length,
    },
    { id: "section-order", score: gotOrder.join("|") === order.join("|") ? 1 : 0 },
  ];
}
