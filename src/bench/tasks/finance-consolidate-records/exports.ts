import type { Rng } from "../../core/rng.ts";
import { csv } from "../../core/text.ts";

export const VENDORS = [
  "Cloud Nine Hosting",
  "Rail Cafe",
  "Ledgerly Software",
  "SkyHop Airlines",
  "Meridian Legal LLP",
  "Northwind Design Co",
  "Granite Insurance",
  "Beacon Recruiting",
  "Harbor Coworking",
  "Quill Analytics",
];

export function usDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function euDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function accounting(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

export function cents(r: Rng, lo: number, hi: number): number {
  return r.int(lo * 100, hi * 100) / 100;
}

export interface Exports {
  bank: Array<Array<string | number>>;
  card: Array<Array<string | number>>;
  invoices: Array<Record<string, string | number>>;
  paypal: string[];
  payroll: string[];
  eurRate: number;
}

export function exportFiles(e: Exports): Record<string, string> {
  return {
    "finance/bank-export.csv": csv(["Date (MM/DD/YYYY)", "Description", "Amount (accounting format)", "Ref"], e.bank),
    "finance/card-export.csv": csv(["posted (DD.MM.YYYY)", "merchant", "amount_cents", "cardholder", "ref"], e.card),
    "finance/invoices.json": JSON.stringify(e.invoices, null, 2) + "\n",
    "finance/paypal.csv": `date;merchant;amount;currency;ref\n${e.paypal.join("\n")}\n`,
    "finance/payroll.txt": `# date        employee                   gross  ref\n${e.payroll.join("\n")}\n`,
    "finance/fx.csv": csv(["currency", "usd_per_unit"], [["EUR", e.eurRate.toFixed(2)]]),
    "finance/README.md":
      [
        "Bank amounts use accounting format: parentheses mean money out.",
        "Card rows are always money out, in cents. A card row whose ref also appears in the bank export is the bank settlement of that card charge; keep the bank row and drop the card row.",
        "Invoices: payable is money out, receivable is money in.",
        "PayPal is semicolon separated with a decimal comma, in EUR; convert at finance/fx.csv and round to cents. Always money out.",
        "Payroll is fixed width, gross salary, always money out. Vendor is 'Payroll <employee>'.",
      ].join("\n") + "\n",
  };
}
