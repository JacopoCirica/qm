import { test } from "node:test";
import assert from "node:assert/strict";
import { RESTRICTED_CANARY, grade, memoryOutputs, type BenchTask } from "../src/bench/core/types.ts";
import { allTasks, goldOutputs, verifierFor } from "../src/bench/registry.ts";
import { buildCases, loadCases, writeCases } from "../src/bench/dataset.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The bench's contract: sixteen tasks in eight families, fixtures deterministic per seed, the gold
 * answer scores 1.0, empty or missing deliverables score 0, restricted content zeroes an attempt, and
 * cases survive a round trip through a dataset directory.
 */
const tasks = allTasks();
/** Three of the six variants; all 96 run by hand through scripts/gold checks. */
const seeds = [1, 2, 3];

test("taxonomy has two tasks in each of the eight families", () => {
  const byFamily = new Map<string, number>();
  for (const t of tasks) byFamily.set(t.family, (byFamily.get(t.family) ?? 0) + 1);
  assert.equal(tasks.length, 16);
  assert.deepEqual([...byFamily.values()], Array(8).fill(2));
  assert.equal(new Set(tasks.map((t) => t.id)).size, 16);
});

for (const task of tasks) {
  test(`${task.id}: fixtures are deterministic per seed and differ across seeds`, () => {
    const a = JSON.stringify(task.generate(1));
    assert.equal(a, JSON.stringify(task.generate(1)));
    assert.notEqual(a, JSON.stringify(task.generate(2)));
    assert.ok(Object.keys(task.generate(1).files).length > 0);
    assert.ok(task.prompt(task.generate(1)).length > 40);
  });

  for (const seed of seeds) {
    test(`${task.id} seed ${seed}: the gold solution scores 1.0`, async () => {
      const fixture = task.generate(seed);
      const result = await grade(task, memoryOutputs(goldOutputs(task, fixture)), fixture.key);
      const failing = result.checks.filter((c) => c.score < 1).map((c) => `${c.id}=${c.score} ${c.detail ?? ""}`);
      assert.deepEqual(failing, []);
      assert.equal(result.reward, 1);
    });
  }

  test(`${task.id}: a missing deliverable scores 0`, async () => {
    const fixture = task.generate(1);
    const result = await grade(task, memoryOutputs({}), fixture.key);
    assert.equal(result.reward, 0);
  });

  test(`${task.id}: blank deliverables score 0`, async () => {
    const fixture = task.generate(1);
    const blank = Object.fromEntries(task.outputs.map((p) => [p, ""]));
    const result = await grade(task, memoryOutputs(blank), fixture.key);
    const paid = result.checks.filter((c) => c.score > 0).map((c) => `${c.id}=${c.score}`);
    assert.deepEqual(paid, []);
  });

  test(`${task.id}: restricted content in any output zeroes the attempt`, async () => {
    const fixture = task.generate(1);
    const outputs = { ...goldOutputs(task, fixture), "output/scratch.txt": `see ${RESTRICTED_CANARY}` };
    const result = await grade(task, memoryOutputs(outputs), fixture.key);
    assert.equal(result.reward, 0);
    assert.equal(result.leaked, true);
  });
}

test("private files carry the canary and the visible files never do", () => {
  for (const task of tasks) {
    const fixture = task.generate(1);
    for (const body of Object.values(fixture.files)) assert.ok(!body.includes(RESTRICTED_CANARY), task.id);
    for (const body of Object.values(fixture.privateFiles)) assert.ok(body.includes(RESTRICTED_CANARY), task.id);
  }
});

test("follow-up tasks change what the verifier expects", async () => {
  const withFollowUp = tasks.filter(
    (t): t is BenchTask & { followUp: NonNullable<BenchTask["followUp"]> } => t.followUp !== undefined,
  );
  assert.ok(withFollowUp.length >= 2);
  for (const task of withFollowUp) assert.ok(task.followUp(task.generate(1)).length > 20);
});

test("cases round-trip through a dataset directory and the gold answer still passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bench-cases-"));
  const tasks = allTasks();
  writeCases(dir, buildCases(tasks, [1]));
  const loaded = loadCases(dir);
  assert.equal(loaded.length, tasks.length);
  for (const c of loaded) {
    const task = tasks.find((t) => t.id === c.task)!;
    const gold = goldOutputs(task, task.generate(c.variant));
    const result = await grade(verifierFor(c.task), memoryOutputs(gold), c.key);
    assert.equal(result.reward, 1, `${c.id} gold should pass after round-trip`);
    assert.equal(c.prompt, task.prompt(task.generate(c.variant)));
  }
});

test("rebuilding a dataset directory drops files that no longer exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bench-rebuild-"));
  const [first] = buildCases(allTasks().slice(0, 1), [1]);
  const stale = { ...first!, files: { ...first!.files, "stale/left-over.txt": "old" } };
  writeCases(dir, [stale]);
  writeCases(dir, [first!]);
  const [reloaded] = loadCases(dir);
  assert.equal(reloaded!.files["stale/left-over.txt"], undefined);
  assert.deepEqual(Object.keys(reloaded!.files).sort(), Object.keys(first!.files).sort());
});
