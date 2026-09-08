import { type BenchTask, defineTask } from "../../core/types.ts";
import { type ExceptionsKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

export function task(): BenchTask {
  return defineTask<ExceptionsKey>({
    id: "finance-flag-exceptions",
    difficulty: "hard",
    family: "finance",
    origin: "research",
    evidence:
      "Garry Tan's Own Your Intelligence talk (17:43): finance staff workflows such as reviewing records against policy.",
    sources: ["https://www.youtube.com/watch?v=eRrc1pUY5oU&t=1063s"],
    outputs: ["output/exceptions.json"],
    generate,
    prompt: () =>
      'Work out the expense rules from audit/reviewed.csv (read audit/README.md), then review finance/expenses.csv against them. Write output/exceptions.json as {"rules": {"meal_limit_per_attendee": n, "receipt_required_above": n, "travel_approval_above": n}, "exceptions": [{"id", "rule"}, ...]} using the rule codes from the audit. An expense that breaks two rules appears twice; expenses that break nothing must not appear. Write a script.',
    verify,
  });
}
