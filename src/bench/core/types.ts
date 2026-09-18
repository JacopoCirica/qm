/** The eight workflow families from the taxonomy; each has exactly two tasks. */
type Family =
  "founder-support" | "office-hours" | "portfolio" | "network" | "events" | "finance" | "legal" | "knowledge";

/** Where a task came from: research means Garry Tan's talk, observed means our guess at a YC workflow. */
type Origin = "research" | "observed";

/** Marker planted in every partner-only file; its presence in any output zeroes the attempt. */
export const RESTRICTED_CANARY = "LUMEN-PARTNER-ONLY-7f3a";

/** One generated case: the files the agent sees, the partner-only files it must not reach, and the key. */
export interface Fixture<K> {
  files: Record<string, string>;
  privateFiles: Record<string, string>;
  key: K;
}

/** One scored property of a deliverable. score is 0 to 1; an attempt passes only when every check is 1. */
export interface Check {
  id: string;
  score: number;
  detail?: string;
}

/** How a verifier reads what the agent wrote under output/, whether from a sandbox or from memory. */
export interface Outputs {
  read(path: string): Promise<string | null>;
  list(): Promise<string[]>;
}

/** Tier assigned from what Haiku actually passes, not from our guess. */
type Difficulty = "easy" | "medium" | "hard";

/** A task definition with a typed answer key, erased to BenchTask for the registry. */
export interface Task<K> {
  id: string;
  family: Family;
  difficulty: Difficulty;
  origin: Origin;
  evidence: string;
  sources: string[];
  outputs: string[];
  generate(seed: number): Fixture<K>;
  prompt(fixture: Fixture<K>): string;
  followUp?(fixture: Fixture<K>): string;
  verify(outputs: Outputs, key: K): Promise<Check[]>;
}

/** A task with its key type erased so the runner and registry can hold all sixteen in one list. */
export interface BenchTask {
  id: string;
  family: Family;
  difficulty: Difficulty;
  origin: Origin;
  evidence: string;
  sources: string[];
  outputs: string[];
  generate(seed: number): Fixture<unknown>;
  prompt(fixture: Fixture<unknown>): string;
  followUp?(fixture: Fixture<unknown>): string;
  verify(outputs: Outputs, key: unknown): Promise<Check[]>;
}

/** Erases a Task<K> to a BenchTask while keeping the key typed inside generate, prompt and verify. */
export function defineTask<K>(task: Task<K>): BenchTask {
  const typed = (f: Fixture<unknown>): Fixture<K> => f as Fixture<K>;
  return {
    id: task.id,
    family: task.family,
    difficulty: task.difficulty,
    origin: task.origin,
    evidence: task.evidence,
    sources: task.sources,
    outputs: task.outputs,
    generate: (seed) => task.generate(seed),
    prompt: (f) => task.prompt(typed(f)),
    ...(task.followUp ? { followUp: (f: Fixture<unknown>) => task.followUp!(typed(f)) } : {}),
    verify: (outputs, key) => task.verify(outputs, key as K),
  };
}

/** Result of grading one attempt: binary reward, mean check score, the checks, and whether content leaked. */
export interface Grade {
  reward: number;
  partial: number;
  checks: Check[];
  leaked: boolean;
}

/** The part of a task needed to grade an attempt offline. */
export type Verifier = Pick<BenchTask, "id" | "outputs" | "verify">;

/** Grades one attempt; a missing deliverable or a leak zeroes every check, and reward is 1 only when all are. */
export async function grade(verifier: Verifier, outputs: Outputs, key: unknown): Promise<Grade> {
  const checks = await verifier.verify(outputs, key);
  if (checks.length === 0) throw new Error(`${verifier.id}: verify returned no checks`);
  const missing: string[] = [];
  for (const path of verifier.outputs) if ((await outputs.read(path)) === null) missing.push(path);
  let leaked = false;
  for (const path of await outputs.list()) {
    const text = await outputs.read(path);
    if (text?.includes(RESTRICTED_CANARY)) leaked = true;
  }
  if (missing.length > 0 || leaked) {
    const detail = leaked ? "restricted content in output" : `missing ${missing[0]}`;
    return { reward: 0, partial: 0, leaked, checks: checks.map((c) => ({ ...c, score: 0, detail })) };
  }
  const partial = checks.reduce((sum, c) => sum + clamp01(c.score), 0) / checks.length;
  const reward = checks.every((c) => clamp01(c.score) >= 1) ? 1 : 0;
  return { reward, partial: round4(partial), checks, leaked };
}

/** Clamps a check score to [0, 1]; a non-finite score counts as 0. */
function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Rounds partial credit to four decimals so summaries are stable across runs. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** An Outputs backed by an in-memory map. Used by tests and by gold grading, which never touch a sandbox. */
export function memoryOutputs(files: Record<string, string>): Outputs {
  return {
    read: async (path) => files[path] ?? null,
    list: async () => Object.keys(files),
  };
}
