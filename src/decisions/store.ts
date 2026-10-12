import { createPgPool, withPgTransaction } from "../persistence/pg-pool.ts";
import { checkRuleSet, type DecisionHook, type DecisionProvider, type DecisionRule } from "./decisions.ts";

export interface DecisionStore {
  providers(): Promise<DecisionProvider[]>;
  rules(hook?: DecisionHook): Promise<DecisionRule[]>;
  saveProvider(provider: DecisionProvider, actorId: string): Promise<void>;
  removeProvider(id: string): Promise<void>;
  saveRule(rule: DecisionRule, actorId: string): Promise<void>;
  removeRule(id: string): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS decision_providers(
    provider_id TEXT   PRIMARY KEY,
    protocol    TEXT   NOT NULL,
    base_url    TEXT,
    credential  TEXT,
    updated_by  TEXT   NOT NULL,
    updated_at  BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS decision_rules(
    rule_id     TEXT    PRIMARY KEY,
    hook        TEXT    NOT NULL,
    question    TEXT    NOT NULL,
    options     JSON    NOT NULL,
    provider_id TEXT    NOT NULL REFERENCES decision_providers(provider_id),
    model       TEXT    NOT NULL,
    mode        TEXT    NOT NULL CHECK (mode IN ('off', 'observe', 'enforce')),
    on_error    TEXT    NOT NULL,
    updated_by  TEXT    NOT NULL,
    updated_at  BIGINT  NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS decision_rules_hook ON decision_rules (hook) WHERE mode <> 'off'`,
];

const toRule = (r: Record<string, unknown>): DecisionRule => ({
  id: r.rule_id as string,
  hook: r.hook as DecisionHook,
  question: r.question as string,
  options: r.options as DecisionRule["options"],
  model: { provider: r.provider_id as string, model: r.model as string },
  mode: r.mode as DecisionRule["mode"],
  onError: r.on_error as string,
});

const RULES = "SELECT * FROM decision_rules";
const MAX_STORED_RULES = 200;
const CACHE_MS = 10_000;

export function createPostgresDecisionStore(connectionString: string): DecisionStore {
  const { q, pool } = createPgPool(connectionString, "decisions/0001", SCHEMA);
  const active = new Map<DecisionHook, { at: number; rules: Promise<DecisionRule[]> }>();
  const load = async (hook: DecisionHook) =>
    (await q(`${RULES} WHERE hook = $1 AND mode <> 'off' ORDER BY rule_id`, [hook])).map(toRule);
  const changed = () => active.clear();
  return {
    async providers() {
      const rows = await q("SELECT * FROM decision_providers ORDER BY provider_id");
      return rows.map((r) => ({
        id: r.provider_id as string,
        protocol: r.protocol as DecisionProvider["protocol"],
        ...(r.base_url ? { baseUrl: r.base_url as string, credential: r.credential as string } : {}),
      }));
    },
    async rules(hook) {
      if (!hook) return (await q(`${RULES} ORDER BY rule_id`)).map(toRule);
      const hit = active.get(hook);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
      const rules = load(hook);
      active.set(hook, { at: Date.now(), rules });
      rules.catch(() => active.delete(hook));
      return rules;
    },
    async saveProvider(p, actorId) {
      await q(
        `INSERT INTO decision_providers (provider_id, protocol, base_url, credential, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (provider_id) DO UPDATE SET protocol = $2, base_url = $3, credential = $4, updated_by = $5, updated_at = $6`,
        [p.id, p.protocol, p.baseUrl ?? null, p.credential ?? null, actorId, Date.now()],
      );
    },
    async removeProvider(id) {
      try {
        await q("DELETE FROM decision_providers WHERE provider_id = $1", [id]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503")
          throw new Error(`decision provider ${id} is still used by a rule`, { cause: error });
        throw error;
      }
    },
    async saveRule(rule, actorId) {
      await withPgTransaction(await pool(), async (db) => {
        await db.query("LOCK TABLE decision_rules IN SHARE ROW EXCLUSIVE MODE");
        const { rows } = await db.query(
          "SELECT count(*)::int AS n, bool_or(rule_id = $1) AS exists FROM decision_rules",
          [rule.id],
        );
        if (!rows[0].exists && rows[0].n >= MAX_STORED_RULES)
          throw new Error(`at most ${MAX_STORED_RULES} decision rules; remove one first`);
        const active = await db.query(`${RULES} WHERE rule_id <> $1 AND mode <> 'off' ORDER BY rule_id`, [rule.id]);
        const error = checkRuleSet([...active.rows.map(toRule), rule]);
        if (error) throw new Error(error);
        await db.query(
          `INSERT INTO decision_rules
             (rule_id, hook, question, options, provider_id, model, mode, on_error, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (rule_id) DO UPDATE SET hook = $2, question = $3, options = $4, provider_id = $5, model = $6,
             mode = $7, on_error = $8, updated_by = $9, updated_at = $10`,
          [
            rule.id,
            rule.hook,
            rule.question,
            JSON.stringify(rule.options),
            rule.model.provider,
            rule.model.model,
            rule.mode,
            rule.onError,
            actorId,
            Date.now(),
          ],
        );
      });
      changed();
    },
    async removeRule(id) {
      await q("DELETE FROM decision_rules WHERE rule_id = $1", [id]);
      changed();
    },
  };
}
