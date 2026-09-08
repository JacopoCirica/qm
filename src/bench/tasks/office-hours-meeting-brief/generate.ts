import { type Rng, rng } from "../../core/rng.ts";
import { csv, emailThread } from "../../core/text.ts";
import type { Fixture } from "../../core/types.ts";
import { COMPANY_WORDS, addDays, personName } from "../../core/world.ts";

export interface Slot {
  time: string;
  room: string;
  company: string;
  founder: string;
  tracker: string;
}

export interface BriefKey {
  date: string;
  finalSlots: Slot[];
  removed: string[];
}

const BLOCKERS = [
  "security review before renewal",
  "founding designer search",
  "pilot stuck in procurement",
  "GPU quota",
  "payments partner compliance",
  "cofounder disagreement on roadmap",
  "churn in the mid-market segment",
  "SOC 2 audit timeline",
];

const TIMES = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
];

function tracker(r: Rng): string {
  return `OH-${1000 + r.int(1, 8999)}`;
}

function swapRoom(slot: Slot, pair: [Slot, Slot]): Slot {
  if (slot.company === pair[0].company) return { ...slot, room: pair[1].room };
  if (slot.company === pair[1].company) return { ...slot, room: pair[0].room };
  return slot;
}

export function generate(seed: number): Fixture<BriefKey> {
  const r = rng(seed * 31337 + 3);
  const date = addDays("2026-09-08", r.int(0, 60));
  const companies = r.sample(COMPANY_WORDS, 30);
  const scheduled = companies.slice(0, 20);
  const pool = companies.slice(20);
  const founders = new Map(companies.map((c) => [c, personName(r)] as const));
  const domains = new Map(companies.map((c) => [c, `${c.toLowerCase()}${r.chance(0.3) ? "hq" : ""}.example`] as const));
  const slots: Slot[] = scheduled.map((company, i) => ({
    time: TIMES[Math.floor(i / 2)]!,
    room: i % 2 === 0 ? "Room A" : "Room B",
    company,
    founder: founders.get(company)!,
    tracker: "",
  }));
  const [cancelA, cancelB, keepBack] = r.sample(scheduled, 3) as [string, string, string];
  const [added, addedThenDropped] = r.sample(pool, 2) as [string, string];
  const moved = r.pick(scheduled.filter((c) => ![cancelA, cancelB, keepBack].includes(c)));
  const movedTo = TIMES[10]!;
  const swapPair = slots.filter((s) => s.time === TIMES[2]) as [Slot, Slot];
  const chat = [
    `[08:02] Dana: ${cancelA} cancelled, founder is travelling.`,
    `[08:10] Priya: ${keepBack} asked to cancel too.`,
    `[08:31] Dana: Adding ${added} at ${TIMES[10]} in Room B.`,
    `[08:40] Priya: ${moved} needs to move to ${movedTo}, Room A.`,
    `[09:05] Dana: Also adding ${addedThenDropped} at ${TIMES[11]} Room A.`,
    `[09:12] Priya: Actually keep ${keepBack} on the schedule, they sorted it out.`,
    `[09:20] Dana: ${cancelB} is out, no reschedule.`,
    `[09:41] Priya: swap rooms for ${swapPair[0].company} and ${swapPair[1].company}, the projector is broken.`,
    `[10:15] Dana: ${addedThenDropped} can't make it after all, drop them.`,
  ];
  const files: Record<string, string> = {
    "calendar/schedule.json":
      JSON.stringify({ date, slots: slots.map((s) => ({ time: s.time, room: s.room, company: s.company })) }, null, 2) +
      "\n",
    "calendar/changes-chat.md": `# #office-hours-ops, ${addDays(date, -1)}\n\n${chat.join("\n")}\n`,
    "directory/companies.csv": csv(
      ["company", "email_domain", "founder"],
      companies.map((c) => [c, domains.get(c)!, founders.get(c)!]),
    ),
  };
  const attending = new Map<string, string>();
  const trackers = new Map<string, string>();
  for (const company of companies) {
    const founder = founders.get(company)!;
    const cofounder = personName(r);
    const swapFounder = r.chance(0.3);
    const current = tracker(r);
    trackers.set(company, current);
    attending.set(company, swapFounder ? cofounder : founder);
    const from = `${founder} <${founder.split(" ")[0]!.toLowerCase()}@${domains.get(company)!}>`;
    files[`updates/${r.int(100000, 999999).toString(16)}.md`] = emailThread([
      {
        from,
        date: addDays(date, -r.int(8, 14)),
        subject: "Update",
        body: `Blocker: ${r.pick(BLOCKERS)}.\nTracking: ${tracker(r)}`,
      },
      {
        from: "Dana <partners@lumen.example>",
        date: addDays(date, -7),
        subject: "Update",
        body: "Thanks, noted. Anything new before office hours?",
      },
      {
        from,
        date: addDays(date, -r.int(1, 5)),
        subject: "Update",
        body: `Blocker now: ${r.pick(BLOCKERS)}.\nTracking: ${current}${swapFounder ? `\n${cofounder} (my cofounder) will attend office hours instead of me.` : ""}`,
      },
    ]);
  }
  const withAdds: Slot[] = [
    ...slots,
    { time: TIMES[10]!, room: "Room B", company: added, founder: founders.get(added)!, tracker: "" },
  ];
  const finalSlots = withAdds
    .filter((s) => ![cancelA, cancelB].includes(s.company))
    .map((s) => (s.company === moved ? { ...s, time: movedTo, room: "Room A" } : s))
    .map((s) => swapRoom(s, swapPair))
    .map((s) => ({ ...s, founder: attending.get(s.company)!, tracker: trackers.get(s.company)! }))
    .sort((a, b) => a.time.localeCompare(b.time) || a.room.localeCompare(b.room));
  return { files, privateFiles: {}, key: { date, finalSlots, removed: [cancelA, cancelB, addedThenDropped] } };
}
