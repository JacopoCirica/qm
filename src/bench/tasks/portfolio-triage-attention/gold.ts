import { type Fixture } from "../../core/types.ts";
import { type TriageKey } from "./generate.ts";

export function gold(f: Fixture<TriageKey>): Record<string, string> {
  return {
    "output/triage.json": JSON.stringify({
      rules: { low_runway_below_months: f.key.runwayBelow, stale_after_days: f.key.staleAfter },
      flagged: f.key.flagged,
    }),
  };
}
