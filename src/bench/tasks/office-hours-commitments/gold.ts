import type { Fixture } from "../../core/types.ts";
import type { CommitmentsKey } from "./generate.ts";

/**
 * Reference answer: the corrected commitments and the open subset straight from the key.
 */
export function gold(f: Fixture<CommitmentsKey>): Record<string, string> {
  return {
    "output/commitments.json": JSON.stringify(f.key.afterCorrections),
    "output/open.json": JSON.stringify(f.key.open),
  };
}
