import type { Fixture } from "../../core/types.ts";
import type { FactsKey } from "./generate.ts";

export function gold(f: Fixture<FactsKey>): Record<string, string> {
  return { "output/facts.json": JSON.stringify(f.key.durable.map((d) => d.gold)) };
}
