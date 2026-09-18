import { csv } from "../../core/text.ts";
import type { Fixture } from "../../core/types.ts";
import type { ConsolidateKey } from "./generate.ts";

/** Reference answer: the key's ledger rows as CSV with two-decimal amounts. */
export function gold(f: Fixture<ConsolidateKey>): Record<string, string> {
  return {
    "output/ledger.csv": csv(
      ["date", "amount", "vendor", "source", "ref"],
      f.key.rows.map((x) => [x.date, x.amount.toFixed(2), x.vendor, x.source, x.ref]),
    ),
  };
}
