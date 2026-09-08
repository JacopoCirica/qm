import type { Fixture } from "../../core/types.ts";
import type { ExceptionsKey } from "./generate.ts";

export function gold(f: Fixture<ExceptionsKey>): Record<string, string> {
  const k = f.key;
  return {
    "output/exceptions.json": JSON.stringify({
      rules: {
        meal_limit_per_attendee: k.mealLimit,
        receipt_required_above: k.receiptFloor,
        travel_approval_above: k.travelFloor,
      },
      exceptions: k.expected.map((e) => ({ id: e.split("|")[0], rule: e.split("|")[1] })),
    }),
  };
}
