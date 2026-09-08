import { rng } from "../../core/rng.ts";
import type { Fixture } from "../../core/types.ts";
import { COMPANY_WORDS, addDays, personName } from "../../core/world.ts";
import { type Exports, VENDORS, accounting, cents, euDate, exportFiles, usDate } from "./exports.ts";

interface Ledger {
  date: string;
  amount: number;
  vendor: string;
  source: string;
  ref: string;
}

export interface ConsolidateKey {
  totals: Record<string, number>;
  counts: Record<string, number>;
  duplicateRefs: string[];
  rows: Ledger[];
}

export function generate(seed: number): Fixture<ConsolidateKey> {
  const r = rng(seed * 3907 + 13);
  const eurRate = 1 + r.int(5, 15) / 100;
  const rows: Ledger[] = [];
  const bank: Exports["bank"] = [];
  const card: Exports["card"] = [];
  const paypal: string[] = [];
  const payroll: string[] = [];
  const invoices: Exports["invoices"] = [];
  let refN = 4000;
  const ref = (): string => `TX${++refN}`;
  for (let i = 0; i < r.int(500, 700); i++) {
    const date = addDays("2026-08-01", r.int(0, 30));
    const amount = r.chance(0.8) ? -cents(r, 50, 20000) : cents(r, 500, 30000);
    const vendor = r.pick(VENDORS);
    const id = ref();
    rows.push({ date, amount, vendor, source: "bank", ref: id });
    bank.push([usDate(date), vendor, accounting(amount), id]);
  }
  const duplicateRefs: string[] = [];
  for (let i = 0; i < r.int(500, 700); i++) {
    const date = addDays("2026-08-01", r.int(0, 30));
    const c = r.int(500, 250000);
    const vendor = r.pick(VENDORS);
    const dup = r.chance(0.06) ? rows.filter((x) => x.source === "bank")[r.int(0, 50)]! : undefined;
    const id = dup ? dup.ref : ref();
    if (dup) duplicateRefs.push(id);
    else rows.push({ date, amount: -c / 100, vendor, source: "card", ref: id });
    card.push([
      euDate(dup ? dup.date : date),
      dup ? dup.vendor : vendor,
      dup ? Math.round(Math.abs(dup.amount) * 100) : c,
      personName(r),
      id,
    ]);
  }
  for (let i = 0; i < r.int(200, 300); i++) {
    const date = addDays("2026-08-01", r.int(0, 30));
    const total = cents(r, 200, 15000);
    const payable = r.chance(0.7);
    const vendor = payable ? r.pick(VENDORS) : `${r.pick(COMPANY_WORDS)} Inc`;
    const id = ref();
    rows.push({ date, amount: payable ? -total : total, vendor, source: "invoice", ref: id });
    invoices.push({
      issued: date,
      counterparty: vendor,
      total_usd: total,
      direction: payable ? "payable" : "receivable",
      reference: id,
    });
  }
  for (let i = 0; i < r.int(150, 250); i++) {
    const date = addDays("2026-08-01", r.int(0, 30));
    const eur = cents(r, 10, 900);
    const usd = Math.round(eur * eurRate * 100) / 100;
    const vendor = r.pick(VENDORS);
    const id = ref();
    rows.push({ date, amount: -usd, vendor, source: "paypal", ref: id });
    paypal.push(`${date};${vendor};${eur.toFixed(2).replace(".", ",")};EUR;${id}`);
  }
  const people = Array.from({ length: 12 }, () => personName(r));
  for (const p of people) {
    for (const date of ["2026-08-15", "2026-08-31"]) {
      const gross = r.int(4000, 12000);
      const id = ref();
      rows.push({ date, amount: -gross, vendor: `Payroll ${p}`, source: "payroll", ref: id });
      payroll.push(`${date}  ${p.padEnd(24)}${String(gross).padStart(8)}.00  ${id}`);
    }
  }
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    totals[row.source] = Math.round(((totals[row.source] ?? 0) + row.amount) * 100) / 100;
    counts[row.source] = (counts[row.source] ?? 0) + 1;
  }
  const files = exportFiles({ bank, card, invoices, paypal, payroll, eurRate });
  return { files, privateFiles: {}, key: { totals, counts, duplicateRefs, rows } };
}
