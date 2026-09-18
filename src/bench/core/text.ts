import type { Rng } from "./rng.ts";

/**
 * Writes a CSV with RFC-style quoting. Fixture exports go through here so agents see ordinary
 * spreadsheets.
 */
export function csv(header: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

/**
 * Reads a CSV written by an agent into rows keyed by header. Lenient on blank lines and stray carriage
 * returns so a verifier judges content, not formatting.
 */
/**
 * Splits a comma-separated word pool written as one string, so long lists stay a few lines. Line
 * breaks inside an entry collapse to one space.
 */
export function list(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h.trim()] = (cells[i] ?? "").trim()));
    return row;
  });
}

/** Splits one CSV line, honouring double quotes and doubled quotes inside them. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parses agent output as JSON, returning undefined for a missing file or invalid text so verifiers can
 * score it as a miss instead of crashing.
 */
export function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Narrows unknown JSON to an array, or an empty one. Verifiers never trust the shape of agent output. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Narrows unknown JSON to an object, or an empty one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Coerces an agent-supplied value to a trimmed string; anything that is not a string or number becomes
 * empty.
 */
export function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * Parses money and numbers the way a person wrote them: strips $ and commas, treats (123) as negative,
 * NaN otherwise.
 */
export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Case-insensitive set F1 between an expected and an actual list. The standard partial-credit score
 * for list deliverables; identical empty sets score 1.
 */
export function f1(expected: Iterable<string>, actual: Iterable<string>): number {
  const e = new Set([...expected].map((s) => s.toLowerCase()));
  const a = new Set([...actual].map((s) => s.toLowerCase()));
  if (e.size === 0 && a.size === 0) return 1;
  let hit = 0;
  for (const x of a) if (e.has(x)) hit++;
  if (hit === 0) return 0;
  const precision = hit / a.size;
  const recall = hit / e.size;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Fraction of expected pairs that appear in the right relative order in the actual list. Scores
 * ordering separately from membership.
 */
export function orderScore(expected: string[], actual: string[]): number {
  const pos = new Map(actual.map((id, i) => [id.toLowerCase(), i] as const));
  let pairs = 0;
  let ordered = 0;
  for (let i = 0; i < expected.length; i++) {
    for (let j = i + 1; j < expected.length; j++) {
      const a = pos.get(expected[i]!.toLowerCase());
      const b = pos.get(expected[j]!.toLowerCase());
      if (a === undefined || b === undefined) continue;
      pairs++;
      if (a < b) ordered++;
    }
  }
  return pairs === 0 ? 0 : ordered / pairs;
}

/** Numeric equality within a tolerance, false for anything non-finite. */
export function close(a: number, b: number, tolerance = 0.5): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

/** Word count, used for per-person length limits on drafted emails. */
export function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Case-insensitive substring test against a list of cues. */
export function includesAny(text: string, needles: string[]): boolean {
  const low = text.toLowerCase();
  return needles.some((n) => low.includes(n.toLowerCase()));
}

/** Number words for numberWords, which lets fixtures write amounts the way people do in prose. */
const ONES = list(`
  zero, one, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve, thirteen,
  fourteen, fifteen, sixteen, seventeen, eighteen, nineteen
`);
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Joins "<count> <unit>" with the words for whatever is left over, e.g. "two thousand" + "fifty". */
function scaled(unit: string, count: number, rest: number): string {
  return `${numberWords(count)} ${unit}${rest ? ` ${numberWords(rest)}` : ""}`;
}

/** Spells an integer in English words, up to the millions ("forty-two thousand five hundred"). */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
  if (n < 1000) return scaled("hundred", Math.floor(n / 100), n % 100);
  if (n < 1000000) return scaled("thousand", Math.floor(n / 1000), n % 1000);
  return scaled("million", Math.floor(n / 1000000), n % 1000000);
}

/**
 * Picks one of several ways people write a dollar amount ($1,200, $1.2k, USD 1200, words). Fixtures
 * use it so an agent cannot grep for one format.
 */
export function moneyPhrase(r: Rng, n: number): string {
  const k = n / 1000;
  return r.pick([
    `$${n.toLocaleString("en-US")}`,
    `$${Number.isInteger(k) ? k : k.toFixed(1)}k`,
    `${numberWords(n)} dollars`,
    `USD ${n}`,
    `$${(n / 1000).toFixed(2)} thousand`,
  ]);
}

/** One message in a generated email thread. */
export interface Mail {
  from: string;
  date: string;
  subject: string;
  body: string;
}

/**
 * Renders a thread the way mail clients do: each reply quotes every earlier message with > prefixes.
 * This is how stale ids and figures end up restated inside a newer email.
 */
export function emailThread(mails: Mail[]): string {
  const out: string[] = [];
  mails.forEach((m, i) => {
    out.push(
      `From: ${m.from}`,
      `Sent: ${m.date}`,
      `Subject: ${i === 0 ? m.subject : `Re: ${m.subject}`}`,
      "",
      m.body,
      "",
    );
    for (let j = i - 1; j >= 0; j--) {
      const q = mails[j]!;
      out.push(`> On ${q.date}, ${q.from} wrote:`, ...q.body.split("\n").map((l) => `> ${l}`), ">");
    }
    out.push("-----");
  });
  return out.join("\n") + "\n";
}
