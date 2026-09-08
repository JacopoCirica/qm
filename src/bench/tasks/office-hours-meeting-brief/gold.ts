import type { Fixture } from "../../core/types.ts";
import type { BriefKey } from "./generate.ts";

export function gold(f: Fixture<BriefKey>): Record<string, string> {
  return {
    "output/brief.json": JSON.stringify({
      slots: f.key.finalSlots.map((s) => ({
        time: s.time,
        room: s.room,
        company: s.company,
        founder: s.founder,
        tracking: s.tracker,
      })),
    }),
  };
}
