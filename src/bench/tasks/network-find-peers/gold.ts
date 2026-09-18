import type { Fixture } from "../../core/types.ts";
import type { PeersKey } from "./generate.ts";

/**
 * Reference answer from the key: up to five eligible people, same-city first, each with a why that
 * quotes their
 * matched expertise phrase. Names are placeholders because the verifier matches on surname plus company.
 */
export function gold(f: Fixture<PeersKey>): Record<string, string> {
  const preferred = new Set(f.key.preferred);
  const ranked = [...f.key.eligible].sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a))).slice(0, 5);
  return {
    "output/peers.json": JSON.stringify(
      ranked.map((k) => {
        const [last, company] = k.split("|") as [string, string];
        return {
          name: `X ${last[0]!.toUpperCase()}${last.slice(1)}`,
          company,
          why: `Same sector; their profile lists "${f.key.phraseOf[k]}"`,
        };
      }),
    ),
  };
}
