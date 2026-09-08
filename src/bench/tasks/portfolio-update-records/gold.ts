import { csv } from "../../core/text.ts";
import { type Fixture } from "../../core/types.ts";
import { type CompanyRow, type UpdateKey } from "./generate.ts";

export function gold(f: Fixture<UpdateKey>): Record<string, string> {
  return {
    "output/companies.csv": csv(
      f.key.header,
      f.key.expected.map((c) => f.key.header.map((h) => c[h as keyof CompanyRow])),
    ),
  };
}
