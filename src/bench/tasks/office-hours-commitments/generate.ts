import { rng } from "../../core/rng.ts";
import type { Fixture } from "../../core/types.ts";
import { addDays, personName } from "../../core/world.ts";

interface Commitment {
  owner: string;
  task: string;
  due: string;
}

export interface CommitmentsKey {
  founder: string;
  partner: string;
  asOf: string;
  afterCorrections: Commitment[];
  open: Array<Commitment & { overdue: boolean }>;
  corrections: { movedA: Commitment; movedB: Commitment; cancelled: Commitment; added: Commitment };
}

const COMMITMENT_TASKS = [
  "send the updated deck",
  "make the intro to the bank",
  "share the hiring plan",
  "ship the self-serve tier",
  "review the pricing page",
  "send the security questionnaire",
  "book the customer call",
  "draft the board update",
  "close the SOC 2 vendor",
  "post the engineering job",
  "send the cap table",
  "schedule the offsite",
];

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : day % 10]!;
}

function dayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDate();
}

export function generate(seed: number): Fixture<CommitmentsKey> {
  const r = rng(seed * 48611 + 9);
  const founder = personName(r);
  const partner = personName(r);
  const meetingDate = addDays("2026-09-01", r.int(0, 20));
  const tasks = r.sample(COMMITMENT_TASKS, 12);
  const initial: Commitment[] = tasks
    .slice(0, 8)
    .map((task, i) => ({ owner: i % 2 === 0 ? founder : partner, task, due: addDays(meetingDate, r.int(2, 24)) }));
  const restated = new Set(r.sample(initial, 2));
  const blocks: string[][] = [];
  for (const c of initial) {
    const other = c.owner === founder ? partner : founder;
    const first = restated.has(c) ? addDays(c.due, r.pick([2, -3])) : c.due;
    const block = [
      `${other}: Can you ${c.task} by the ${dayOf(first)}${ordinal(dayOf(first))}?`,
      `${c.owner}: Yes, I will ${c.task} by ${first}.`,
    ];
    if (restated.has(c))
      block.push(
        `${c.owner}: Actually, make that ${c.due} for ${c.task.split(" ").slice(-2).join(" ")}, I have a conflict.`,
      );
    blocks.push(block);
  }
  const filler = [
    "Makes sense.",
    "Let me think about that.",
    "Right.",
    "What about the metrics?",
    "We saw the same thing last quarter.",
    "Can we come back to hiring?",
    "Agreed.",
    "That is fair.",
  ];
  const chatter = [
    [`${partner}: How did the launch land?`, `${founder}: Noisy. I will have a real read in two weeks.`],
    [`${partner}: One idea, a referral program. No commitment, just think about it.`],
    [
      `${founder}: Could you intro me to someone at Harbor Logistics?`,
      `${partner}: I do not know anyone there, sorry.`,
    ],
    [`${founder}: I might ${tasks[8]} at some point, not sure when.`],
    [`${partner}: We should ${tasks[9]}. I will not have time this month though.`],
    [`${founder}: Someone on my team will ${tasks[10]} eventually.`],
    ...Array.from({ length: 40 }, () => [`${r.pick([founder, partner])}: ${r.pick(filler)}`]),
  ];
  const lines = [
    `# Office hours transcript, ${meetingDate}`,
    `Attendees: ${founder} (founder), ${partner} (partner)`,
    "",
  ];
  for (const block of r.shuffle([...blocks, ...chatter])) lines.push(...block);
  const files: Record<string, string> = { [`transcripts/oh-${meetingDate}.md`]: lines.join("\n") + "\n" };
  const [movedA, movedB, cancelled] = [initial[0]!, initial[3]!, initial[5]!];
  const added: Commitment = { owner: partner, task: tasks[11]!, due: addDays(meetingDate, 30) };
  const newA = { ...movedA, due: addDays(movedA.due, 4) };
  const newB = { ...movedB, due: addDays(movedB.due, -1) };
  const replaced = new Map<Commitment, Commitment>([
    [movedA, newA],
    [movedB, newB],
  ]);
  const afterCorrections = initial
    .filter((c) => c !== cancelled)
    .map((c) => replaced.get(c) ?? c)
    .concat([added]);
  const asOf = addDays(meetingDate, 15);
  const done = new Set(r.sample(afterCorrections, 3));
  files["tracking/completed.md"] =
    `# Completed as of ${asOf}\n\n${[...done].map((c) => `- ${c.owner}: ${c.task}`).join("\n")}\n`;
  const open = afterCorrections.filter((c) => !done.has(c)).map((c) => ({ ...c, overdue: c.due < asOf }));
  return {
    files,
    privateFiles: {},
    key: {
      founder,
      partner,
      asOf,
      afterCorrections,
      open,
      corrections: { movedA: newA, movedB: newB, cancelled, added },
    },
  };
}
