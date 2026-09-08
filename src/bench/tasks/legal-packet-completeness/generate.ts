import { type Rng, rng } from "../../core/rng.ts";
import { csv } from "../../core/text.ts";
import type { Fixture } from "../../core/types.ts";
import { COMPANY_WORDS } from "../../core/world.ts";

interface DocSpec {
  canonical: string;
  accepted: string[];
  rounds: string[];
}

const DOCS: DocSpec[] = [
  { canonical: "safe.pdf", accepted: ["safe.pdf", "SAFE.pdf", "safe-signed.pdf"], rounds: ["safe"] },
  {
    canonical: "stock-purchase-agreement.pdf",
    accepted: ["stock-purchase-agreement.pdf", "spa.pdf", "SPA-executed.pdf"],
    rounds: ["priced"],
  },
  {
    canonical: "cap-table.csv",
    accepted: ["cap-table.csv", "cap_table.csv", "cap-table.xlsx"],
    rounds: ["safe", "priced"],
  },
  {
    canonical: "incorporation.pdf",
    accepted: ["incorporation.pdf", "certificate-of-incorporation.pdf"],
    rounds: ["safe", "priced"],
  },
  {
    canonical: "founder-ids.pdf",
    accepted: ["founder-ids.pdf", "founder_ids.pdf", "ids.pdf"],
    rounds: ["safe", "priced"],
  },
  { canonical: "kyc-form.pdf", accepted: ["kyc-form.pdf", "kyc.pdf"], rounds: ["safe", "priced"] },
  { canonical: "bank-letter.pdf", accepted: ["bank-letter.pdf", "bank_letter.pdf"], rounds: ["safe", "priced"] },
  {
    canonical: "board-consent.pdf",
    accepted: ["board-consent.pdf", "board_consent.pdf", "consent.pdf"],
    rounds: ["priced"],
  },
  { canonical: "ip-assignment.pdf", accepted: ["ip-assignment.pdf", "ip_assignment.pdf"], rounds: ["safe", "priced"] },
  { canonical: "investor-rights.pdf", accepted: ["investor-rights.pdf", "ira.pdf"], rounds: ["priced"] },
];

export interface PacketKey {
  missing: Record<string, string[]>;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function packetNames(r: Rng, n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) {
    const base = r.pick(COMPANY_WORDS);
    out.add(slugify(out.has(slugify(base)) ? `${base} ${r.pick(["Labs", "Systems", "Health", "Bio"])}` : base));
  }
  return [...out];
}

export function generate(seed: number): Fixture<PacketKey> {
  const r = rng(seed * 1213 + 21);
  const companies = packetNames(r, 200);
  const rounds = new Map(companies.map((c) => [c, r.chance(0.6) ? "safe" : "priced"] as const));
  const files: Record<string, string> = {
    "legal/checklist.md":
      [
        "# Investment packet checklist",
        "",
        "Required documents depend on the round type in legal/companies.csv. A document counts if a file with one of its accepted names exists anywhere inside the packet directory, including subfolders, and is not empty.",
        "A file with draft, old, or v1 anywhere in its name never counts. Extra files are fine.",
        "",
        "| document | accepted file names | required for |",
        "|---|---|---|",
        ...DOCS.map((d) => `| ${d.canonical} | ${d.accepted.join(", ")} | ${d.rounds.join(", ")} |`),
      ].join("\n") + "\n",
    "legal/companies.csv": csv(
      ["packet", "round_type"],
      companies.map((c) => [c, rounds.get(c)!]),
    ),
  };
  const missing: Record<string, string[]> = {};
  for (const company of companies) {
    const required = DOCS.filter((d) => d.rounds.includes(rounds.get(company)!));
    const gone = new Set(r.chance(0.4) ? r.sample(required, r.int(1, 3)) : []);
    missing[company] = required.filter((d) => gone.has(d)).map((d) => d.canonical);
    for (const doc of required) {
      const sub = r.chance(0.3) ? `${r.pick(["signed", "final", "docs"])}/` : "";
      if (gone.has(doc)) {
        const mode = r.int(0, 2);
        if (mode === 0)
          files[
            `legal/packets/${company}/${sub}${doc.canonical.replace(/\.(\w+)$/, `-${r.pick(["draft", "old", "v1"])}.$1`)}`
          ] = `draft of ${doc.canonical}\n`;
        if (mode === 1) files[`legal/packets/${company}/${sub}${r.pick(doc.accepted)}`] = "";
      } else files[`legal/packets/${company}/${sub}${r.pick(doc.accepted)}`] = `signed ${doc.canonical}\n`;
    }
    const extra = DOCS.filter((d) => !d.rounds.includes(rounds.get(company)!));
    if (extra.length > 0 && r.chance(0.3))
      files[`legal/packets/${company}/${r.pick(extra).canonical}`] = "not required for this round\n";
    if (r.chance(0.3)) files[`legal/packets/${company}/notes.txt`] = "internal notes\n";
  }
  return { files, privateFiles: {}, key: { missing } };
}
