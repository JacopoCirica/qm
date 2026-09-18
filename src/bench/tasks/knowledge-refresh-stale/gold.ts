import type { Fixture } from "../../core/types.ts";
import type { RefreshKey } from "./generate.ts";

/**
 * Reference answer: the original handbook with each keyed change substituted into its section body.
 */
export function gold(f: Fixture<RefreshKey>): Record<string, string> {
  const body = f.key.original
    .map((s) => {
      const change = f.key.changed[s.title];
      return `## ${s.title}\n${change ? s.body.replace(change.from, change.to) : s.body}\n`;
    })
    .join("\n");
  return { "output/handbook.md": `# Team handbook\n\n${body}` };
}
