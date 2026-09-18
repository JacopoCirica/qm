import { type Rng, rng } from "../../core/rng.ts";
import { csv } from "../../core/text.ts";
import type { Fixture } from "../../core/types.ts";
import { greedy, improve, top2Rate } from "../../families/events-assign.ts";
import { type Assignment, SLOTS, type World, assignKey, buildWorld, worldFiles } from "../../families/events.ts";

/**
 * Answer key: the world after registration changes, the speaker seats that are fixed, and the top-two
 * preference
 * rate the reference solver reaches (the agent must get within half a percent of it).
 */
export interface AssignKey {
  world: World;
  speakers: Array<[string, string]>;
  baselineTop2: number;
}

/**
 * Mutates five percent of attendees' registered slots (one added or dropped each) and returns the rows for
 * events/registration-changes.csv. The attendee export is written before this runs, so the changes file
 * overrides it and an agent that ignores it seats the wrong people.
 */
function registrationChanges(r: Rng, world: World): Array<[string, string, string]> {
  const rows: Array<[string, string, string]> = [];
  for (const a of r.sample(world.attendees, Math.floor(world.attendees.length * 0.05))) {
    const drop = a.slots.length > 1 && r.chance(0.5);
    const slot = drop ? r.pick(a.slots) : r.pick(SLOTS.filter((s) => !a.slots.includes(s)));
    if (!slot) continue;
    a.slots = drop ? a.slots.filter((s) => s !== slot) : [...a.slots, slot].sort();
    rows.push([a.id, drop ? "drop" : "add", slot]);
  }
  return rows;
}

/**
 * Speaker assignments as assignment-map entries keyed attendee|slot, the form the solver and verifier
 * use.
 */
export function fixedSeats(key: Pick<AssignKey, "world" | "speakers">): Assignment {
  const slotOf = new Map(key.world.sessions.map((s) => [s.id, s.slot] as const));
  return new Map(key.speakers.map(([attendee, session]) => [assignKey(attendee, slotOf.get(session)!), session]));
}

/**
 * Reference solver: greedy placement with speakers fixed, then local-search swaps with speakers
 * locked. Used for
 * the baseline rate and for gold.
 */
export function solve(key: Pick<AssignKey, "world" | "speakers">): Assignment {
  const fixed = fixedSeats(key);
  return improve(key.world, greedy(key.world, fixed), new Set(fixed.keys()));
}

/**
 * Builds a 9,000 to 12,000 attendee world with 24 sessions across three slots, one speaker per session
 * who must
 * sit in it, and registration changes that override the export. The scale forces a script; the speakers and
 * changes force reading every input.
 */
export function generate(seed: number): Fixture<AssignKey> {
  const r = rng(seed * 5657 + 8);
  const world = buildWorld(r, r.int(9000, 12000));
  const files = worldFiles(world);
  const changes = registrationChanges(r, world);
  const taken = new Set<string>();
  const speakers: Array<[string, string]> = world.sessions.map((s) => {
    const pick = r.pick(world.attendees.filter((a) => a.slots.includes(s.slot) && !taken.has(a.id)));
    taken.add(pick.id);
    return [pick.id, s.id];
  });
  const key: AssignKey = { world, speakers, baselineTop2: 0 };
  key.baselineTop2 = top2Rate(world, solve(key));
  return {
    files: {
      ...files,
      "events/speakers.csv": csv(["attendee_id", "session_id"], speakers),
      "events/registration-changes.csv": csv(["attendee_id", "action", "slot"], changes),
    },
    privateFiles: {},
    key,
  };
}
