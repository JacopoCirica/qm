import { type BenchTask, defineTask } from "../../core/types.ts";
import { type BriefKey, generate } from "./generate.ts";
import { verify } from "./verify.ts";

/**
 * Meeting brief: the agent rebuilds the day's office-hours schedule from the published calendar,
 * an ops chat of changes and reversals, and each company's latest update email.
 * Tests applying changes in order, matching senders by domain, and taking only the newest email
 * across several threads while ignoring quoted stale ids.
 */
export function task(): BenchTask {
  return defineTask<BriefKey>({
    id: "office-hours-meeting-brief",
    difficulty: "medium",
    family: "office-hours",
    origin: "research",
    evidence:
      "Garry Tan's Own Your Intelligence talk (16:16): meeting prep assembled from prior notes and the latest updates.",
    sources: ["https://www.youtube.com/watch?v=eRrc1pUY5oU&t=934s"],
    outputs: ["output/brief.json"],
    generate,
    prompt: (f) =>
      `Prepare the office hours brief for ${f.key.date}. The published schedule is calendar/schedule.json; every change since is in calendar/changes-chat.md in order, and a later message can undo an earlier one. Write output/brief.json as {"slots": [...]}, each {"time", "room", "company", "founder", "tracking"}. ` +
      "founder is whoever the company's latest email across all of updates/ says will attend (a company can have more than one thread; only the newest email counts, and an older thread's attendance note does not carry over); tracking is the Tracking id in that latest email (quoted older emails carry stale ids). Update files are named at random; match a company by the sender's email domain using directory/companies.csv. Order by time then room. Leave cancelled meetings out.",
    verify,
  });
}
