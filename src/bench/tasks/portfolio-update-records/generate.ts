import { type Rng, rng } from "../../core/rng.ts";
import { csv, emailThread, moneyPhrase, numberWords } from "../../core/text.ts";
import { type Fixture } from "../../core/types.ts";
import { COMPANY_WORDS, SECTORS, addDays, personName } from "../../core/world.ts";
import { companyNames, slugify } from "../../families/portfolio.ts";

/**
 * One row of portfolio/companies.csv.
 */
export interface CompanyRow {
  slug: string;
  name: string;
  sector: string;
  mrr_usd: number;
  headcount: number;
  last_update: string;
}

/**
 * Answer key: the column order and the rows after every valid update is applied.
 */
export interface UpdateKey {
  header: string[];
  expected: CompanyRow[];
}

/**
 * Column order the output must keep.
 */
const HEADER = ["slug", "name", "sector", "mrr_usd", "headcount", "last_update"];

/** How the founder states MRR: words or figures, sometimes in EUR to convert at the fx rate. */
function mrrPhrase(r: Rng, newMrr: number | undefined, inEur: boolean, eurRate: number): string {
  if (newMrr === undefined) return "";
  if (inEur) return `€${(Math.round((newMrr / eurRate) * 100) / 100).toLocaleString("en-US")} MRR`;
  return `MRR ${moneyPhrase(r, newMrr)}`;
}

/** A thread date two or more days from the company's others, so the newer thread is clear. */
function freshDate(r: Rng, used: Set<string>): string {
  for (;;) {
    const date = addDays("2026-09-01", r.int(0, 25));
    if (!used.has(date) && !used.has(addDays(date, 1))) {
      used.add(date);
      return date;
    }
  }
}

/** Builds 200 companies and 120 update threads with corrections, EUR and outside senders. */
export function generate(seed: number): Fixture<UpdateKey> {
  const r = rng(seed * 7727 + 1);
  const names = companyNames(r, 200);
  const rows: CompanyRow[] = names.map((name) => ({
    slug: slugify(name),
    name,
    sector: r.pick(SECTORS),
    mrr_usd: r.int(5, 90) * 1000,
    headcount: r.int(2, 30),
    last_update: addDays("2026-06-01", r.int(0, 60)),
  }));
  const domains = new Map(
    rows.map((c) => [c.slug, `${c.slug.replace(/-/g, "")}${r.chance(0.25) ? "hq" : ""}.example`] as const),
  );
  const eurRate = 1 + r.int(5, 15) / 100;
  const expected: CompanyRow[] = rows.map((row) => ({ ...row }));
  const files: Record<string, string> = {
    "portfolio/companies.csv": csv(
      HEADER,
      rows.map((c) => HEADER.map((h) => c[h as keyof CompanyRow])),
    ),
    "portfolio/domains.csv": csv(
      ["slug", "email_domain"],
      rows.map((c) => [c.slug, domains.get(c.slug)!]),
    ),
    "finance/fx.csv": csv(
      ["currency", "usd_per_unit"],
      [
        ["EUR", eurRate.toFixed(2)],
        ["GBP", (eurRate + 0.15).toFixed(2)],
      ],
    ),
    "updates/README.md":
      "One file per email thread, named at random. Match the company by the sender's domain in portfolio/domains.csv. Amounts in EUR convert at finance/fx.csv, rounded to the nearest dollar. The last message in a thread is the founder's final word.\n",
  };
  const updated = r.sample(rows, 120);
  for (const row of updated) {
    const founder = personName(r);
    const from = `${founder} <${founder.split(" ")[0]!.toLowerCase()}@${domains.get(row.slug)!}>`;
    const threads = r.chance(0.3) ? 2 : 1;
    let latest = "";
    const usedDates = new Set<string>();
    for (let t = 0; t < threads; t++) {
      const date = freshDate(r, usedDates);
      const newMrr = r.chance(0.8) ? Math.round(row.mrr_usd * (1 + r.int(-10, 40) / 100)) : undefined;
      const newHead = r.chance(0.7) ? Math.max(1, row.headcount + r.int(-2, 6)) : undefined;
      const inEur = newMrr !== undefined && r.chance(0.25);
      const mrrText = mrrPhrase(r, newMrr, inEur, eurRate);
      const headText =
        newHead === undefined
          ? ""
          : r.pick([`Team is ${newHead} now.`, `Headcount ${numberWords(newHead)}.`, `We are ${newHead} people.`]);
      const mails = [
        {
          from,
          date,
          subject: `${row.name} update`,
          body: [mrrText || "Revenue update next month.", headText].filter(Boolean).join("\n"),
        },
      ];
      if (newMrr !== undefined && r.chance(0.3)) {
        const wrong = Math.round(newMrr * 1.04);
        mails[0]!.body = mails[0]!.body.replace(
          mrrText,
          inEur
            ? `€${(Math.round((wrong / eurRate) * 100) / 100).toLocaleString("en-US")} MRR`
            : `MRR ${moneyPhrase(r, wrong)}`,
        );
        mails.push({
          from: "Dana <partners@lumen.example>",
          date,
          subject: `${row.name} update`,
          body: "Thanks. Is that MRR final?",
        });
        mails.push({
          from,
          date: addDays(date, 1),
          subject: `${row.name} update`,
          body: `Correction, ${mrrText}. Everything else stands.`,
        });
      }
      files[`updates/${r.int(100000, 999999).toString(16)}.md`] = emailThread(mails);
      const effective = mails[mails.length - 1]!.date;
      usedDates.add(effective);
      if (effective > latest) {
        latest = effective;
        const target = expected.find((c) => c.slug === row.slug)!;
        if (newMrr !== undefined)
          target.mrr_usd = inEur ? Math.round((Math.round((newMrr / eurRate) * 100) / 100) * eurRate) : newMrr;
        if (newHead !== undefined) target.headcount = newHead;
        target.last_update = effective;
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    files[`updates/${r.int(100000, 999999).toString(16)}.md`] = emailThread([
      {
        from: `${personName(r)} <hello@${r.pick(COMPANY_WORDS).toLowerCase()}-notaportfolio.example>`,
        date: addDays("2026-09-01", r.int(0, 25)),
        subject: "Intro",
        body: `MRR ${moneyPhrase(r, r.int(5, 50) * 1000)}. Team of ${r.int(2, 9)}. Would love to join the program.`,
      },
    ]);
  }
  return { files, privateFiles: {}, key: { header: HEADER, expected } };
}
