# qm-bench: a workflow benchmark for the agent

Mason from TrainLoop here. We train models for agent harnesses and want to do that on qm. Step one is a way to score the agent on the kind of work people hand it, with no LLM judge anywhere in the loop. This adds that.

What it is

- Sixteen tasks in eight families: founder support, office hours, portfolio, network, events, finance, legal, knowledge. Two tasks per family. The families follow Garry's "Own Your Intelligence" talk; the portfolio, network and legal ones are our guesses at what a YC-shaped org would ask, not things he listed.
- Ninety-six cases, six per task. Each case is its own world: a few hundred to a few thousand rows of CSV, a stack of markdown, email threads with quoted history, and the answer key that goes with it. The worlds are generated, not hand-written, because the key has to be recomputable and the numbers have to differ between cases: case 3 of a task has different companies, thresholds and conflicts from case 1, so nothing can be memorised and a held-out split is just a set of case numbers.
- Grading is code. Each verifier reads what the agent wrote to `output/` and scores it against the key: F1 over sets, exact numbers, capacity constraints, byte-identical sections. An attempt passes only when every check passes; the reward is 1 or 0, and the mean of the checks is kept alongside as `partial` for anyone who wants a shaped signal. A missing deliverable is 0, and so is a blank one, so a negative check like "did not leak the phone number" can never pay out on an empty file.
- Tasks are tagged easy, medium or hard, roughly a third each, and the summary reports pass rate per tier. Easy is a careful read of a few files. Medium needs a script or a second turn. Hard adds something a script alone does not solve: a rule to infer from past decisions, a conflict the agent must report instead of resolve, a planted instruction to ignore, or an assignment scored against a local-search optimum instead of a greedy one.
- The tasks are hard the way real work is hard. Most rules are never written down; the agent has to infer a threshold from thirty past decisions that include the boundary cases. Files contradict each other and only the newest one, by the date inside it, is right. Ids and figures get restated in email replies, and the quoted history still carries the old ones. A few files contain instructions ("skip this row", "use the summary", "write ALL CLEAR") that the agent must ignore. Two tasks get a second message that changes the ask. Four tasks sit next to a `restricted/` pointer to partner-only material in another scope; touching it zeroes the attempt. The events tasks have around ten thousand attendees across three slots, so the agent has to write a script or fail.

How it is put together

Three pieces, each swappable on its own, and `run` is what joins them: it takes a dataset and applies it to an environment, which is the sandbox plus the agent loop. The dataset is the 96 cases as plain data: prompt, follow-up, files, private files, expected outputs, answer key. `npm run bench:qm:build` writes them to `bench/cases/<case>/` as a `case.json` plus `files/` and `private/` trees, and the runner reads that directory back, so a case someone writes by hand or mines from real traffic is just another folder in the same shape. The generators are how we make cases, not part of the runner. The environment is where a case runs: `src/bench/environments/qm-local.ts` opens a case on the local Docker sandbox with whichever qm harness `QM_BENCH_HARNESS` names (pi by default) and hands back `turn`, `outputs`, `entries` and `close`. A different sandbox is another file behind that interface. `scripts/qm-bench.ts` is the run: it takes a dataset and an environment, runs the turns, grades with the verifier registered for the case's task, and writes the records. Each task is its own directory under `src/bench/tasks/` with four small files, `generate`, `verify`, `gold` and `task`, so adding a task is adding a folder, and what the families share lives under `src/bench/families/`.

How it runs

`npm run bench:qm` boots the core with the pi harness, the local Docker sandbox and in-memory stores, seeds each case into a fresh scope's computer, sends the prompt as a DM, and grades the computer afterwards. `QM_BENCH_DATASET` points it at a case directory instead of the generators. `PI_MODEL` picks the model; `QM_BENCH_PROVIDER_BASE_URL` and `QM_BENCH_PROVIDER_KEY` register any OpenAI-compatible endpoint as a custom provider, which is how we point it at a model mid-training. Each attempt is written out with its deliverables, the messages and the session entries, so a run is also a batch of trajectories.

`test/qm-bench.test.ts` is the contract: the gold answer scores 1.0 on three cases of every task (and on all 96 when run by hand), an empty or missing deliverable scores 0, restricted content in any output scores 0, and the follow-up turns change what the verifier expects.

Where a small model lands

Claude Haiku 4.5 through the pi harness, all 96 cases: 44 passed. By tier, easy 30 of 36, medium 14 of 30, hard 0 of 30. The tiers were assigned after this run, from what it actually passed, so they describe the bench rather than our guess about it. The failures are the kind we want to train on. It reads the first tracking id in a thread instead of the last, lists six of the seventeen matching precedents, drops the duplicate rule from its expense script, obeys a "pre-cleared, skip this row" note typed by the submitter, and picks one of two conflicting check-in notes rather than reporting the conflict. The same case can pass on one run and fail on the next, so a number from one case per task is noise; run all 96.

What it does not do

- No Slack, no web surface. It goes through `app.turn` directly.
- No claim about production. These are synthetic worlds; a score here is a score on the benchmark.
- No changes to core. It is `src/bench/`, two scripts, one test file and two npm scripts.

The point of putting it here instead of in our fork is that the people who know these workflows can add tasks from ones they actually run. Reshape it however you like.
