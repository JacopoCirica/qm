import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../../config.ts";
import { buildApp } from "../../wiring.ts";
import { scopeId, type TurnRequest, type WorkspaceLayer } from "../../types.ts";
import { localContainerName, localNetworkName, localVolumeName } from "../../sandbox/local-sandbox.ts";
import type { SandboxHandle } from "../../sandbox/sandbox.ts";
import type { BenchCase } from "../dataset.ts";
import { type Outputs } from "../core/types.ts";

interface TurnOutcome {
  status: string;
  reply: string;
}

interface CaseSession {
  turn(text: string): Promise<TurnOutcome>;
  outputs(): Promise<Outputs>;
  entries(): Promise<unknown[]>;
  close(): Promise<void>;
}

export interface Environment {
  open(benchCase: BenchCase, runId: string): Promise<CaseSession>;
  close(): Promise<void>;
}

export interface QmLocalOptions {
  harness: Config["harness"];
  modelId: string;
  providerBaseUrl?: string;
  providerKey?: string;
}

function dm(actorId: string, text: string): TurnRequest {
  return {
    surface: "bench",
    actor: { externalId: actorId },
    conversation: { kind: "dm", threadRef: `thread-${actorId}` },
    text,
  };
}

function removeDockerResources(actorId: string): void {
  for (const suffix of ["", "-partners"]) {
    const scope = scopeId("personal", `${actorId}${suffix}`);
    const container = localContainerName(scope);
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", localVolumeName(scope)], { stdio: "ignore" });
    spawnSync("docker", ["network", "rm", localNetworkName(container)], { stdio: "ignore" });
  }
}

export async function qmLocalEnvironment(options: QmLocalOptions): Promise<Environment> {
  const dataDir = mkdtempSync(join(tmpdir(), "qm-bench-"));
  const config: Config = {
    ...loadConfig(),
    port: 0,
    dataDir,
    sessionStore: "memory",
    runStore: "memory",
    harness: options.harness,
    securityPosture: "dangerous",
    memoryStrategy: "agent-only",
    sandboxBackend: "local",
    modelId: options.modelId,
  };
  const built = buildApp(config);
  if (options.providerBaseUrl) {
    await built.customProviders.upsert(
      {
        id: "bench",
        name: "Benchmark provider",
        protocol: "openai",
        baseUrl: options.providerBaseUrl,
        models: [{ id: options.modelId, contextWindow: 200000, maxTokens: 16000 }],
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
  const outputsFor = (handle: SandboxHandle): Outputs => ({
    read: (path) => built.sandbox.readFile(handle, path),
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
      rmSync(dataDir, { recursive: true, force: true });
    },
    async open(benchCase, runId) {
      const actorId = `qm-bench-${benchCase.id}-${runId}-${Date.now().toString(36)}`;
      const sessionIds: string[] = [];
      const partnerScope = scopeId("personal", `${actorId}-partners`);
      await built.workspace.ensureScope(partnerScope);
      for (const [path, body] of Object.entries(benchCase.privateFiles))
        await built.workspace.write(partnerScope, path, body);
      const seedHandle = await built.sandbox.provision(layersFor(actorId));
      try {
        for (const [path, body] of Object.entries(benchCase.files))
          await built.sandbox.writeFile(seedHandle, path, body);
      } finally {
        await built.sandbox.teardown(seedHandle);
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
            if (graderHandle) await built.sandbox.teardown(graderHandle, { destroy: true });
          } finally {
            removeDockerResources(actorId);
          }
        },
      };
    },
  };
}
