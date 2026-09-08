import type { Fixture } from "../../core/types.ts";
import type { CommitmentsKey } from "./generate.ts";

export function gold(f: Fixture<CommitmentsKey>): Record<string, string> {
  return {
    "output/commitments.json": JSON.stringify(f.key.afterCorrections),
    "output/open.json": JSON.stringify(f.key.open),
  };
}
