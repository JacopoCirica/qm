import type { Fixture } from "../../core/types.ts";
import type { AdviceKey } from "./generate.ts";

export function gold(f: Fixture<AdviceKey>): Record<string, string> {
  const k = f.key;
  return {
    "output/advice.json": JSON.stringify({
      latest_mrr: k.latestMrr,
      mom_growth_pct: k.growthPct,
      implied_arr: k.impliedArr,
      runway_months: k.runwayMonths,
      recommendation: k.recommendation,
      runway_threshold_months: k.runwayThreshold,
      growth_threshold_pct: k.growthThreshold,
      sources: ["metrics/metrics.csv", "memos/README.md", "inbox/question.md"],
    }),
  };
}
