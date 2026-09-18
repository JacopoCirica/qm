import type { Rng } from "../core/rng.ts";
import { csv, parseCsv } from "../core/text.ts";
import { COMPANY_WORDS, personName } from "../core/world.ts";

/** The three breakout time slots of the event day. */
export const SLOTS = ["T1", "T2", "T3"];
/** Share of a session's seats one company may fill; the per-company cap in the published rules. */
const COMPANY_SHARE = 0.15;

/** Per-company seat cap for a session: 15% of capacity rounded up, never below two. */
export function companyCap(capacity: number): number {
  return Math.max(2, Math.ceil(capacity * COMPANY_SHARE));
}

/** One breakout session: which slot it runs in and how many seats it has. */
export interface Session {
  id: string;
  slot: string;
  title: string;
  capacity: number;
}

/** One attendee: the slots they registered for and six ranked session preferences across all slots. */
export interface Attendee {
  id: string;
  name: string;
  company: string;
  slots: string[];
  prefs: string[];
}

/** The whole event: sessions and attendees. Both events tasks generate one of these. */
export interface World {
  sessions: Session[];
  attendees: Attendee[];
}

/** Session titles, 24 of them, spread round-robin over the three slots. */
const TITLES = [
  "Pricing and packaging",
  "Enterprise sales",
  "Hiring your first ten",
  "Fundraising",
  "Infrastructure costs",
  "Founder mental health",
  "Design partners",
  "Compliance early",
  "Developer marketing",
  "Cofounder dynamics",
  "Board management",
  "Churn analysis",
  "Outbound that works",
  "Hardware supply chains",
  "Regulated markets",
  "Community led growth",
  "Support at scale",
  "International expansion",
  "Payments and billing",
  "Data rooms",
  "Security posture",
  "Open source business",
  "Consumer retention",
  "Agents in production",
];

/**
 * Generates an event of the given size, then scales each slot's capacities to about 108% of that
 * slot's demand so seats are scarce but feasible.
 */
export function buildWorld(r: Rng, attendeeCount: number): World {
  const sessions: Session[] = TITLES.map((title, i) => ({
    id: `S${i + 1}`,
    slot: SLOTS[i % 3]!,
    title,
    capacity: r.int(40, 140),
  }));
  const companies = COMPANY_WORDS.flatMap((w) => [w, `${w} Labs`, `${w} Systems`]);
  const attendees: Attendee[] = [];
  for (let i = 1; i <= attendeeCount; i++) {
    const slots = SLOTS.filter(() => r.chance(0.75));
    if (slots.length === 0) slots.push(r.pick(SLOTS));
    const prefs = new Set<string>();
    while (prefs.size < 6) prefs.add(r.pick(sessions).id);
    attendees.push({
      id: `A${String(i).padStart(5, "0")}`,
      name: personName(r),
      company: r.pick(companies),
      slots,
      prefs: [...prefs],
    });
  }
  for (const slot of SLOTS) {
    const need = attendees.filter((a) => a.slots.includes(slot)).length * 1.08;
    const inSlot = sessions.filter((s) => s.slot === slot);
    const total = inSlot.reduce((sum, s) => sum + s.capacity, 0);
    for (const s of inSlot) s.capacity = Math.max(8, Math.round((s.capacity * need) / total));
  }
  return { sessions, attendees };
}

/** attendee|slot to session id, the shape both the gold solver and the verifier work in. */
export type Assignment = Map<string, string>;

/** Builds the attendee|slot key an Assignment is indexed by. */
export function assignKey(attendee: string, slot: string): string {
  return `${attendee}|${slot}`;
}

/** Parses an agent's assignments.csv into an Assignment, upper-casing ids so case never decides a score. */
export function readAssignments(text: string | null): { assign: Assignment; rows: number } {
  const assign: Assignment = new Map();
  const rows = parseCsv(text ?? "");
  for (const row of rows)
    assign.set(
      assignKey((row.attendee_id ?? "").toUpperCase(), (row.slot ?? "").toUpperCase()),
      (row.session_id ?? "").toUpperCase(),
    );
  return { assign, rows: rows.length };
}

/** The rules.md the agent reads. The gold solver follows exactly these. */
function rules(): string {
  return (
    [
      "# Breakout assignment rules",
      "",
      "- The day has three time slots, T1, T2 and T3. Each session belongs to one slot.",
      "- Every attendee gets exactly one session in each slot they registered for, and none in slots they did not.",
      "- A session may not exceed its capacity.",
      `- No more than ${Math.round(COMPANY_SHARE * 100)}% of a session's capacity (rounded up, and never fewer than 2 seats) may come from the same company.`,
      "- Preferences are ranked across all slots; within a slot, honor the highest-ranked preference that fits, then the next.",
      "- Someone who can get none of their choices in a slot goes to that slot's session with the most free seats.",
    ].join("\n") + "\n"
  );
}

/** The files an events case seeds into the sandbox: rules, sessions and attendees. */
export function worldFiles(world: World): Record<string, string> {
  return {
    "events/rules.md": rules(),
    "events/sessions.csv": csv(
      ["session_id", "slot", "title", "capacity"],
      world.sessions.map((s) => [s.id, s.slot, s.title, s.capacity]),
    ),
    "events/attendees.csv": csv(
      ["attendee_id", "name", "company", "registered_slots", "pref1", "pref2", "pref3", "pref4", "pref5", "pref6"],
      world.attendees.map((a) => [a.id, a.name, a.company, a.slots.join(";"), ...a.prefs]),
    ),
  };
}

/** Writes an Assignment as the assignments.csv deliverable, sorted for stable diffs. */
export function assignmentCsv(assign: Assignment): string {
  return csv(
    ["attendee_id", "slot", "session_id"],
    [...assign].sort().map(([k, sid]) => [...(k.split("|") as [string, string]), sid]),
  );
}
