import type { Fixture } from "../../core/types.ts";
import type { PacketKey } from "./generate.ts";

export function gold(f: Fixture<PacketKey>): Record<string, string> {
  const out: Record<string, { complete: boolean; missing: string[] }> = {};
  for (const [c, missing] of Object.entries(f.key.missing)) out[c] = { complete: missing.length === 0, missing };
  return { "output/completeness.json": JSON.stringify(out) };
}
