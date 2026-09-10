import { rng } from "../../core/rng.ts";
import { csv } from "../../core/text.ts";
import type { Fixture } from "../../core/types.ts";
import { greedy, improve, top2Rate } from "../../families/events-assign.ts";
import { type Assignment, type World, assignKey, buildWorld, worldFiles } from "../../families/events.ts";

export interface AssignKey {
  world: World;
  speakers: Array<[string, string]>;
  baselineTop2: number;
}

export function fixedSeats(key: Pick<AssignKey, "world" | "speakers">): Assignment {
  const slotOf = new Map(key.world.sessions.map((s) => [s.id, s.slot] as const));
  return new Map(key.speakers.map(([attendee, session]) => [assignKey(attendee, slotOf.get(session)!), session]));
}

export function solve(key: Pick<AssignKey, "world" | "speakers">): Assignment {
  const fixed = fixedSeats(key);
  return improve(key.world, greedy(key.world, fixed), new Set(fixed.keys()));
}

export function generate(seed: number): Fixture<AssignKey> {
  const r = rng(seed * 5657 + 8);
  const world = buildWorld(r, r.int(9000, 12000));
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
      ...worldFiles(world),
      "events/speakers.csv": csv(["attendee_id", "session_id"], speakers),
    },
    privateFiles: {},
    key,
  };
}
