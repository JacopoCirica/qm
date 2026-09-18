import type { Fixture } from "../../core/types.ts";
import type { FactsKey } from "./generate.ts";

/**
 * Reference answer: the gold sentence of every durable fact.
 */
export function gold(f: Fixture<FactsKey>): Record<string, string> {
  return { "output/facts.json": JSON.stringify(f.key.durable.map((d) => d.gold)) };
}
