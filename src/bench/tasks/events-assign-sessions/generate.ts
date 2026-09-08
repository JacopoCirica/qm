import { rng } from "../../core/rng.ts";
import type { Fixture } from "../../core/types.ts";
import { greedy, improve, top2Rate } from "../../families/events-assign.ts";
import { type World, buildWorld, worldFiles } from "../../families/events.ts";

export interface AssignKey {
  world: World;
  baselineTop2: number;
}

export function generate(seed: number): Fixture<AssignKey> {
  const r = rng(seed * 5657 + 8);
  const world = buildWorld(r, r.int(9000, 12000));
  return {
    files: worldFiles(world),
    privateFiles: {},
    key: { world, baselineTop2: top2Rate(world, improve(world, greedy(world))) },
  };
}
