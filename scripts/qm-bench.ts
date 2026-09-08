import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../src/config.ts";
import { errMessage } from "../src/util/errors.ts";
import { buildCases, loadCases, type BenchCase } from "../src/bench/dataset.ts";
import { qmLocalEnvironment, type Environment } from "../src/bench/environments/qm-local.ts";
import { grade } from "../src/bench/core/types.ts";
import { allTasks, verifierFor } from "../src/bench/registry.ts";

const modelId = process.env.PI_MODEL;
if (!modelId) {
  console.error(
    "PI_MODEL is required, e.g. PI_MODEL=claude-haiku-4-5 or a model registered through QM_BENCH_PROVIDER_*",
  );
  process.exit(1);
}
const benchModel: string = modelId;
const providerBaseUrl = process.env.QM_BENCH_PROVIDER_BASE_URL;
const providerKey = process.env.QM_BENCH_PROVIDER_KEY;
const harness = process.env.QM_BENCH_HARNESS ?? "pi";
if (!["mock", "pi", "opencode", "codex", "claude"].includes(harness)) {
  console.error(`QM_BENCH_HARNESS must be one of mock, pi, opencode, codex, claude; got ${harness}`);
  process.exit(1);
}
const benchHarness = harness as Config["harness"];
const datasetDir = process.env.QM_BENCH_DATASET;
const taskFilter = (process.env.QM_BENCH_TASKS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const variants = (process.env.QM_BENCH_CASES ?? "1,2,3,4,5,6")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const runId =
  process.env.QM_BENCH_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${modelId.replace(/\//g, "_")}`;
const outDir = join(process.env.QM_BENCH_OUT ?? "runs/qm-bench", runId);

const RATE_LIMIT_PAUSE_MS = 70_000;
const RATE_LIMIT_RETRIES = 3;

const source: BenchCase[] = datasetDir ? loadCases(datasetDir) : buildCases(allTasks(), variants);
const cases = source.filter(
  (c) => (taskFilter.length === 0 || taskFilter.includes(c.task)) && variants.includes(c.variant),
);
if (cases.length === 0) {
  console.error(`no cases match QM_BENCH_TASKS=${taskFilter.join(",")} QM_BENCH_CASES=${variants.join(",")}`);
  process.exit(1);
}

interface CaseRecord {
  task: string;
  family: string;
  difficulty: string;
  case: string;
  variant: number;
  model: string;
  startedAt: string;
  finishedAt: string;
  turns: number;
  statuses: string[];
  reward: number;
  partial: number;
  leaked: boolean;
  checks: Array<{ id: string; score: number; passed: boolean; detail?: string }>;
  outputs: Record<string, string>;
  messages: Array<{ role: string; content: string }>;
  entries: unknown[];
}

async function runCase(env: Environment, benchCase: BenchCase): Promise<CaseRecord> {
  const startedAt = new Date().toISOString();
  const messages: CaseRecord["messages"] = [];
  const statuses: string[] = [];
  const session = await env.open(benchCase, runId);
  try {
    for (const text of [benchCase.prompt, ...(benchCase.followUp ? [benchCase.followUp] : [])]) {
      messages.push({ role: "user", content: text });
      const result = await session.turn(text);
      statuses.push(result.status);
      messages.push({ role: "assistant", content: result.reply });
      if (result.status !== "ok") break;
    }
    const reader = await session.outputs();
    const outputs: Record<string, string> = {};
    for (const path of await reader.list()) outputs[path] = (await reader.read(path)) ?? "";
    const graded = await grade(verifierFor(benchCase.task), reader, benchCase.key);
    return {
      task: benchCase.task,
      family: benchCase.family,
      difficulty: benchCase.difficulty,
      case: benchCase.id,
      variant: benchCase.variant,
      model: benchModel,
      startedAt,
      finishedAt: new Date().toISOString(),
      turns: statuses.length,
      statuses,
      reward: graded.reward,
      partial: graded.partial,
      leaked: graded.leaked,
      checks: graded.checks.map((c) => ({ ...c, passed: c.score >= 1 })),
      outputs,
      messages,
      entries: await session.entries(),
    };
  } finally {
    await session.close();
  }
}

async function runCaseWithBackoff(env: Environment, benchCase: BenchCase): Promise<CaseRecord> {
  for (let retry = 0; ; retry++) {
    try {
      const record = await runCase(env, benchCase);
      const rateLimited = record.messages.some((m) => m.role === "assistant" && m.content.includes("429"));
      if (!rateLimited || retry >= RATE_LIMIT_RETRIES) return record;
    } catch (e) {
      if (!errMessage(e).includes("429") || retry >= RATE_LIMIT_RETRIES) throw e;
    }
    console.log(`  ${benchCase.id}: rate limited, pausing ${RATE_LIMIT_PAUSE_MS / 1000}s before retry ${retry + 1}`);
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
  }
}

function mean(ns: number[]): number | null {
  return ns.length === 0 ? null : Math.round((ns.reduce((s, n) => s + n, 0) / ns.length) * 10000) / 10000;
}

const env = await qmLocalEnvironment({ harness: benchHarness, modelId: benchModel, providerBaseUrl, providerKey });
mkdirSync(outDir, { recursive: true });
console.log(
  `qm-bench ${runId}: ${cases.length} cases from ${datasetDir ?? "generators"}, harness ${harness}, model ${modelId}${providerBaseUrl ? ` via ${providerBaseUrl}` : ""}`,
);
const records: CaseRecord[] = [];
for (const benchCase of cases) {
  try {
    const record = await runCaseWithBackoff(env, benchCase);
    records.push(record);
    mkdirSync(join(outDir, benchCase.task), { recursive: true });
    writeFileSync(join(outDir, benchCase.task, `${benchCase.id}.json`), JSON.stringify(record, null, 2));
    const failing = record.checks
      .filter((c) => c.score < 1)
      .map((c) => `${c.id}=${c.score.toFixed(2)}`)
      .join(" ");
    console.log(
      `  ${record.case}: ${record.reward === 1 ? "PASS" : "FAIL"} partial=${record.partial.toFixed(2)} turns=${record.turns} ${record.statuses.join("/")} ${failing}`,
    );
  } catch (e) {
    console.log(`  ${benchCase.id}: FAILED ${errMessage(e)}`);
  }
}

interface TaskSummary {
  family: string;
  difficulty: string;
  origin: string;
  evidence: string;
  sources: string[];
  prompt: string;
  outputs: string[];
  checks: string[];
  pass_rate: number | null;
  mean_partial: number | null;
  cases: Array<{ case: string; reward: number; partial: number; turns: number }>;
}

const perTask: Record<string, TaskSummary> = {};
for (const task of allTasks()) {
  const rs = records.filter((r) => r.task === task.id);
  if (rs.length === 0) continue;
  perTask[task.id] = {
    family: task.family,
    difficulty: task.difficulty,
    origin: task.origin,
    evidence: task.evidence,
    sources: task.sources,
    prompt: cases.find((c) => c.task === task.id)?.prompt ?? "",
    outputs: task.outputs,
    checks: [...new Set(rs.flatMap((r) => r.checks.map((c) => c.id)))],
    pass_rate: mean(rs.map((r) => r.reward)),
    mean_partial: mean(rs.map((r) => r.partial)),
    cases: rs.map((r) => ({ case: r.case, reward: r.reward, partial: r.partial, turns: r.turns })),
  };
}
const summary = {
  run_id: runId,
  model: modelId,
  base_url: providerBaseUrl ?? "provider default",
  dataset: datasetDir ?? "generators",
  cases_per_task: variants.length,
  finished_at: new Date().toISOString(),
  pass_rate: mean(records.map((r) => r.reward)),
  pass_rate_by_difficulty: Object.fromEntries(
    ["easy", "medium", "hard"].map((d) => [d, mean(records.filter((r) => r.difficulty === d).map((r) => r.reward))]),
  ),
  mean_partial: mean(records.map((r) => r.partial)),
  tasks: perTask,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(
  `pass rate ${summary.pass_rate} (mean partial ${summary.mean_partial}) over ${records.length} cases; wrote ${outDir}`,
);
process.exit(0);
