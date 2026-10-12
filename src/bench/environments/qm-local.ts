import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../../config.ts";
import { buildApp } from "../../wiring.ts";
import { scopeId, type TurnRequest, type WorkspaceLayer } from "../../types.ts";
import type { SandboxHandle } from "../../sandbox/sandbox.ts";
import type { BenchCase } from "../dataset.ts";
import { type Outputs } from "../core/types.ts";
import { assertCasePath } from "../dataset.ts";

/** What one agent turn came back with. */
interface TurnOutcome {
  status: string;
  reply: string;
}

/** One open case: send turns, read output/, pull the session log, tear everything down. */
interface CaseSession {
  turn(text: string): Promise<TurnOutcome>;
  outputs(): Promise<Outputs>;
  entries(): Promise<unknown[]>;
  close(): Promise<void>;
}

/** Where cases run. Swap this to run the same dataset somewhere other than the local Docker sandbox. */
export interface Environment {
  open(benchCase: BenchCase, runId: string): Promise<CaseSession>;
  close(): Promise<void>;
}

/** Which harness and model to drive, plus an optional OpenAI-compatible endpoint as a custom provider. */
export interface QmLocalOptions {
  harness: Config["harness"];
  modelId: string;
  providerBaseUrl?: string;
  providerKey?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** Wraps a prompt as a direct message from the case's actor, the way a Slack DM would arrive. */
function dm(actorId: string, text: string): TurnRequest {
  return {
    surface: "bench",
    actor: { externalId: actorId },
    conversation: { kind: "dm", threadRef: `thread-${actorId}` },
    text,
  };
}

/** Boots one qm core on the local sandbox; each case gets a fresh actor, scope, computer, seeded files and cleanup. */
export async function qmLocalEnvironment(options: QmLocalOptions): Promise<Environment> {
  const dataDir = mkdtempSync(join(tmpdir(), "qm-bench-"));
  const config: Config = {
    ...loadConfig(),
    port: 0,
    dataDir,
    databaseUrl: undefined,
    runStore: "memory",
    sessionStore: "memory",
    snapshotStore: "local",
    transferStore: "local",
    harness: options.harness,
    securityPosture: "dangerous",
    memoryStrategy: "agent-only",
    sandboxBackend: "local",
    modelId: options.modelId,
    opencodeModel: options.modelId,
    codexModel: options.modelId,
    claudeModel: options.modelId,
  };
  const built = buildApp(config);
  if (options.providerBaseUrl) {
    await built.customProviders.upsert(
      {
        id: "bench",
        name: "Benchmark provider",
        protocol: "openai",
        baseUrl: options.providerBaseUrl,
        models: [
          {
            id: options.modelId,
            contextWindow: options.contextWindow ?? 200000,
            maxTokens: options.maxTokens ?? 16000,
          },
        ],
      },
      options.providerKey,
      "qm-bench",
    );
    await built.refreshCustomProviders();
  }
  const layersFor = (actorId: string): WorkspaceLayer[] => [
    { scopeId: scopeId("org", config.orgId), mountPath: "global", mode: "ro" },
    { scopeId: scopeId("personal", actorId), mountPath: "", mode: "rw" },
  ];
  const deliverablePath = (path: string): string => {
    if (!assertCasePath(path).startsWith("output/")) throw new Error(`deliverable outside output/: ${path}`);
    return path;
  };
  const outputsFor = (handle: SandboxHandle): Outputs => ({
    read: (path) => built.sandbox.readFile(handle, deliverablePath(path)),
    list: async () => {
      const result = await built.sandbox.run(handle, "find output -type f 2>/dev/null");
      return result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    },
  });

  return {
    async close() {
      try {
        await built.runtime.stop();
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    async open(benchCase, runId) {
      const actorId = `qm-bench-${benchCase.id}-${runId}-${Date.now().toString(36)}`;
      const scope = scopeId("personal", actorId);
      const sessionIds: string[] = [];
      const partnerScope = scopeId("personal", `${actorId}-partners`);
      // The case's computer. A scope runs on the sandbox resource it routes to, so the
      // case gets one of its own; retiring it removes the container, network and volume.
      const computer = await built.sandboxResources.create(actorId, scope, "local", benchCase.id);
      await built.sandboxResources.setDefault(actorId, scope, computer.id);
      const retire = async (): Promise<void> => {
        await built.sandboxResources.setDefault(actorId, scope, null);
        await built.sandboxResources.retire(actorId, computer.id);
      };
      try {
        await built.workspace.ensureScope(partnerScope);
        for (const [path, body] of Object.entries(benchCase.privateFiles))
          await built.workspace.write(partnerScope, assertCasePath(path), body);
        const seedHandle = await built.sandbox.provision(layersFor(actorId));
        for (const [path, body] of Object.entries(benchCase.files))
          await built.sandbox.writeFile(seedHandle, assertCasePath(path), body);
        await built.sandbox.teardown(seedHandle);
      } catch (error) {
        await retire();
        throw error;
      }
      let graderHandle: SandboxHandle | null = null;
      return {
        async turn(text) {
          const result = await built.app.turn(dm(actorId, text));
          if (result.sessionId) sessionIds.push(result.sessionId);
          return { status: result.status, reply: result.reply ?? result.reason ?? "" };
        },
        async outputs() {
          graderHandle ??= await built.sandbox.provision(layersFor(actorId));
          return outputsFor(graderHandle);
        },
        async entries() {
          const sessionId = sessionIds[0];
          return sessionId ? built.sessions.getEntries(sessionId) : [];
        },
        async close() {
          try {
            if (graderHandle) await built.sandbox.teardown(graderHandle);
          } finally {
            await retire();
          }
        },
      };
    },
  };
}
