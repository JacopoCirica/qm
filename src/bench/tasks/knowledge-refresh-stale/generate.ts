import { rng } from "../../core/rng.ts";
import type { Fixture } from "../../core/types.ts";
import { addDays, personName } from "../../core/world.ts";

interface Section {
  title: string;
  body: string;
}

export interface RefreshKey {
  original: Section[];
  changed: Record<string, { from: string; to: string }>;
  untouchedTitles: string[];
}

const TITLE_WORDS = [
  "Office",
  "Expenses",
  "Office hours",
  "Holidays",
  "Security",
  "Travel",
  "Equipment",
  "Onboarding",
  "Wifi",
  "Insurance",
  "Parental leave",
  "Remote work",
  "Meetings",
  "Interviews",
  "Payroll",
  "Reimbursements",
  "Visitors",
  "Mail",
  "Printing",
  "Calendar",
  "Slack norms",
  "Code review",
  "On-call",
  "Incident process",
  "Data retention",
  "Passwords",
  "Laptops",
  "Software requests",
  "Learning budget",
  "Conference travel",
  "Referrals",
  "Performance reviews",
  "Promotions",
  "Feedback",
  "All hands",
  "Offsites",
  "Snacks",
  "Bike storage",
  "Pets",
  "Guests",
  "Badges",
  "Desks",
  "Lockers",
  "Kitchen",
  "Recycling",
  "Phones",
  "Email",
  "Documents",
  "Contracts",
  "Vendors",
];

export function generate(seed: number): Fixture<RefreshKey> {
  const r = rng(seed * 2731 + 37);
  const titles = [...TITLE_WORDS, ...TITLE_WORDS.map((t) => `${t} (legacy)`), ...TITLE_WORDS.map((t) => `${t} FAQ`)];
  const original: Section[] = titles.map((title) => ({
    title,
    body: `${title} policy: the current value is ${r.pick(["A", "B", "C"])}${r.int(100, 999)} and the owner is ${personName(r)}.`,
  }));
  const aliasOf = new Map<string, string>();
  const aliasLines: string[] = [];
  for (const s of r.sample(original, 30)) {
    const alias = `${r.pick(["Spend", "People", "Site", "Ops", "Team"])} ${s.title.toLowerCase().replace(/[()]/g, "")}`;
    aliasOf.set(s.title, alias);
    aliasLines.push(`- "${alias}" means the section "${s.title}"`);
  }
  const asOf = "2026-10-01";
  const picks = r.sample(original, 40);
  const changed: RefreshKey["changed"] = {};
  const announcements: string[] = [];
  let day = 1;
  picks.forEach((s, i) => {
    const from = s.body.match(/[ABC]\d{3}/)![0];
    const to = `${r.pick(["D", "E", "F"])}${r.int(100, 999)}`;
    const name = aliasOf.get(s.title) ?? s.title;
    const effective = i % 4 === 3 ? addDays(asOf, r.int(5, 60)) : addDays(asOf, -r.int(1, 25));
    const stamp = `2026-09-${String(day).padStart(2, "0")}`;
    announcements.push(`- ${stamp}: ${name}: the value changes from ${from} to ${to}, effective ${effective}.`);
    day = Math.min(28, day + r.int(0, 1));
    if (i % 5 === 1) {
      announcements.push(
        `- 2026-09-${String(Math.min(28, day + 1)).padStart(2, "0")}: ${name}: scratch that, the value stays at ${from}.`,
      );
    } else if (effective <= asOf) changed[s.title] = { from, to };
  });
  const files = {
    "knowledge/handbook.md": `# Team handbook\n\n${original.map((s) => `## ${s.title}\n${s.body}\n`).join("\n")}`,
    "knowledge/aliases.md": `# Section aliases used in announcements\n\n${aliasLines.join("\n")}\n`,
    "updates/announcements.md": `# Announcements, in order\n\nApply as of ${asOf}. An announcement with a later effective date has not happened yet.\n\n${announcements.join("\n")}\n`,
  };
  return {
    files,
    privateFiles: {},
    key: { original, changed, untouchedTitles: original.filter((s) => !changed[s.title]).map((s) => s.title) },
  };
}
