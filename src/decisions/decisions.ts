/**
 * Decision hooks: admin-configured classifiers attached to points in the harness.
 *
 * A rule names a hook, a question, the options the classifier may pick, and the action each
 * option maps to. The classifier only chooses an option; the call site applies the action, so a
 * bad verdict can never do anything the rule did not allow.
 */

const DECISION_HOOKS = ["user_input", "tool_response"] as const;
export type DecisionHook = (typeof DECISION_HOOKS)[number];

/** Ordered from least to most restrictive; when several rules fire, the most restrictive wins. */
const DECISION_ACTIONS = ["allow", "block"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/**
 * A decision provider is an endpoint that answers typed questions. Admins define one or more;
 * rules reference a provider by id plus a model. Keys are never stored in settings: a provider
 * names one of a fixed set of deployment env vars that holds its key.
 *  - litellm: an OpenAI-compatible gateway that serves `openai_decisions/...` and `typesafe/...`
 *    models through its native `typesafe` body (YC's LiteLLM build does).
 *  - openai: OpenAI's Decisions API (`POST /v1/decisions`).
 *  - typesafe: TypeSafe's System One API (Jev).
 */
const DECISION_PROVIDER_KINDS = ["litellm", "openai", "typesafe"] as const;
const DECISION_KEY_ENVS = ["MODEL_GATEWAY_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY"] as const;

export interface DecisionProvider {
  id: string;
  kind: (typeof DECISION_PROVIDER_KINDS)[number];
  /** Defaults per kind; the litellm default is the deployment's model gateway. */
  baseUrl?: string;
  keyEnv?: (typeof DECISION_KEY_ENVS)[number];
  /** Header carrying the key; defaults to a bearer Authorization header. */
  keyHeader?: string;
}

interface DecisionModelRef {
  provider: string;
  model: string;
}

interface DecisionOption {
  description: string;
  action: DecisionAction;
  /** Reason recorded with the action. */
  message?: string;
}

export interface DecisionRule {
  id: string;
  hook: DecisionHook;
  question: string;
  options: Record<string, DecisionOption>;
  model: DecisionModelRef;
  /** observe = classify and audit only; enforce = the chosen action is applied. */
  mode: "observe" | "enforce";
  /** Option applied when the classifier fails or times out. */
  onError: string;
}

export interface DecisionResult {
  ruleId: string;
  option: string;
  action: DecisionAction;
  message?: string;
  probabilities: Record<string, number>;
  mode: DecisionRule["mode"];
  error?: string;
}

export interface DecisionBackend {
  choose(input: {
    question: string;
    state: string;
    options: Record<string, string>;
    model: DecisionModelRef;
    signal: AbortSignal;
  }): Promise<Record<string, number>>;
}

const RULE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OPTION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_RULES = 32;
const MAX_STATE_CHARS = 16_000;

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY_HEADER = /^[a-z][a-z0-9-]{0,63}$/i;

export function parseDecisionProviders(value: unknown): { providers: DecisionProvider[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "decision providers must be an array" };
  const ids = new Set<string>();
  const providers: DecisionProvider[] = [];
  for (const [i, raw] of value.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !PROVIDER_ID.test(r.id))
      return { error: `provider ${i}: id must match ${PROVIDER_ID}` };
    if (ids.has(r.id)) return { error: `provider ${r.id}: duplicate id` };
    ids.add(r.id);
    if (!DECISION_PROVIDER_KINDS.includes(r.kind as DecisionProvider["kind"]))
      return { error: `provider ${r.id}: kind must be one of ${DECISION_PROVIDER_KINDS.join(", ")}` };
    if (r.baseUrl !== undefined) {
      let url: URL;
      try {
        url = new URL(String(r.baseUrl));
      } catch {
        return { error: `provider ${r.id}: baseUrl is not a URL` };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:")
        return { error: `provider ${r.id}: baseUrl must be http(s)` };
    }
    if (r.keyEnv !== undefined && !DECISION_KEY_ENVS.includes(r.keyEnv as DecisionProvider["keyEnv"] & string))
      return { error: `provider ${r.id}: keyEnv must be one of ${DECISION_KEY_ENVS.join(", ")}` };
    if (r.keyHeader !== undefined && (typeof r.keyHeader !== "string" || !KEY_HEADER.test(r.keyHeader)))
      return { error: `provider ${r.id}: keyHeader is not a header name` };
    providers.push({
      id: r.id,
      kind: r.kind as DecisionProvider["kind"],
      ...(r.baseUrl !== undefined ? { baseUrl: String(r.baseUrl) } : {}),
      ...(r.keyEnv !== undefined ? { keyEnv: r.keyEnv as DecisionProvider["keyEnv"] } : {}),
      ...(r.keyHeader !== undefined ? { keyHeader: r.keyHeader as string } : {}),
    });
  }
  return { providers };
}

export function parseDecisionRules(
  value: unknown,
  providers: readonly DecisionProvider[],
): { rules: DecisionRule[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "decision rules must be an array" };
  if (value.length > MAX_RULES) return { error: `at most ${MAX_RULES} decision rules` };
  const ids = new Set<string>();
  const rules: DecisionRule[] = [];
  for (const [i, raw] of value.entries()) {
    const at = `rule ${i}`;
    if (typeof raw !== "object" || raw === null) return { error: `${at} must be an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !RULE_ID.test(r.id)) return { error: `${at}: id must match ${RULE_ID}` };
    if (ids.has(r.id)) return { error: `${at}: duplicate id ${r.id}` };
    ids.add(r.id);
    if (!DECISION_HOOKS.includes(r.hook as DecisionHook))
      return { error: `${r.id}: hook must be one of ${DECISION_HOOKS.join(", ")}` };
    if (typeof r.question !== "string" || !r.question.trim()) return { error: `${r.id}: question is required` };
    if (r.mode !== "observe" && r.mode !== "enforce") return { error: `${r.id}: mode must be observe or enforce` };
    if (typeof r.options !== "object" || r.options === null || Array.isArray(r.options))
      return { error: `${r.id}: options must be an object` };
    const options: Record<string, DecisionOption> = {};
    for (const [key, opt] of Object.entries(r.options as Record<string, unknown>)) {
      if (!OPTION_ID.test(key)) return { error: `${r.id}: option ${key} must match ${OPTION_ID}` };
      const o = opt as Record<string, unknown> | null;
      if (typeof o?.description !== "string" || !o.description.trim())
        return { error: `${r.id}.${key}: description is required` };
      if (!DECISION_ACTIONS.includes(o.action as DecisionAction))
        return { error: `${r.id}.${key}: action must be one of ${DECISION_ACTIONS.join(", ")}` };
      if (o.message !== undefined && typeof o.message !== "string") return { error: `${r.id}.${key}: bad message` };
      options[key] = {
        description: o.description,
        action: o.action as DecisionAction,
        ...(o.message ? { message: o.message } : {}),
      };
    }
    if (Object.keys(options).length < 2) return { error: `${r.id}: at least two options are required` };
    if (typeof r.onError !== "string" || !(r.onError in options))
      return { error: `${r.id}: onError must name one of its options` };
    const m = (r.model ?? {}) as Record<string, unknown>;
    if (typeof m.provider !== "string" || !providers.some((p) => p.id === m.provider))
      return { error: `${r.id}: model.provider must name a configured decision provider` };
    if (typeof m.model !== "string" || !m.model.trim()) return { error: `${r.id}: model.model is required` };
    const model = { provider: m.provider, model: m.model };
    rules.push({
      id: r.id,
      hook: r.hook as DecisionHook,
      question: r.question,
      options,
      model,
      mode: r.mode,
      onError: r.onError,
    });
  }
  return { rules };
}

/** Pick the highest-probability option. Ties go to the more restrictive action. */
function pick(rule: DecisionRule, probabilities: Record<string, number>): string {
  let best = rule.onError;
  let bestP = -1;
  for (const [key, opt] of Object.entries(rule.options)) {
    const p = probabilities[key] ?? 0;
    const restrictive = DECISION_ACTIONS.indexOf(opt.action) > DECISION_ACTIONS.indexOf(rule.options[best]!.action);
    if (p > bestP || (p === bestP && restrictive)) {
      best = key;
      bestP = p;
    }
  }
  return best;
}

async function runDecision(
  rule: DecisionRule,
  state: string,
  backend: DecisionBackend,
  signal: AbortSignal,
): Promise<DecisionResult> {
  const settle = (option: string, probabilities: Record<string, number>, error?: string): DecisionResult => {
    const opt = rule.options[option]!;
    return {
      ruleId: rule.id,
      option,
      action: opt.action,
      ...(opt.message ? { message: opt.message } : {}),
      probabilities,
      mode: rule.mode,
      ...(error ? { error } : {}),
    };
  };
  try {
    const probabilities = await backend.choose({
      question: rule.question,
      state: state.slice(0, MAX_STATE_CHARS).toWellFormed(),
      options: Object.fromEntries(Object.entries(rule.options).map(([k, o]) => [k, o.description])),
      model: rule.model,
      signal,
    });
    return settle(pick(rule, probabilities), probabilities);
  } catch (error) {
    return settle(rule.onError, {}, error instanceof Error ? error.message : String(error));
  }
}

/** Run every rule bound to a hook in parallel. Enforced results decide; observed ones are only returned. */
export async function runHook(
  rules: readonly DecisionRule[],
  hook: DecisionHook,
  state: string,
  backend: DecisionBackend,
  signal: AbortSignal,
): Promise<{ action: DecisionAction; decisive?: DecisionResult; results: DecisionResult[] }> {
  const bound = rules.filter((r) => r.hook === hook);
  const results = await Promise.all(bound.map((r) => runDecision(r, state, backend, signal)));
  let decisive: DecisionResult | undefined;
  for (const result of results) {
    if (result.mode !== "enforce") continue;
    if (!decisive || DECISION_ACTIONS.indexOf(result.action) > DECISION_ACTIONS.indexOf(decisive.action))
      decisive = result;
  }
  return { action: decisive?.action ?? "allow", ...(decisive ? { decisive } : {}), results };
}

function normalize(probabilities: Record<string, number>, options: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const key of Object.keys(options)) {
    const p = probabilities[key];
    const v = typeof p === "number" && Number.isFinite(p) && p > 0 ? p : 0;
    out[key] = v;
    total += v;
  }
  if (total <= 0) throw new Error("classifier returned no usable probabilities");
  for (const key of Object.keys(out)) out[key] = out[key]! / total;
  return out;
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "error",
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`classifier HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function choiceProbabilities(answer: unknown): Record<string, number> {
  const a = (answer ?? {}) as { probabilities?: unknown };
  if (Array.isArray(a.probabilities)) {
    return Object.fromEntries(
      (a.probabilities as { value?: unknown; probability?: unknown }[]).map((p) => [
        String(p.value),
        Number(p.probability),
      ]),
    );
  }
  return (a.probabilities ?? {}) as Record<string, number>;
}

const DEFAULT_BASE: Record<DecisionProvider["kind"], string> = {
  litellm: "",
  openai: "https://api.openai.com/v1",
  typesafe: "https://api.typesafe.ai/v1",
};
const DEFAULT_KEY_ENV: Record<DecisionProvider["kind"], DecisionProvider["keyEnv"]> = {
  litellm: "MODEL_GATEWAY_API_KEY",
  openai: "OPENAI_API_KEY",
  typesafe: "TYPESAFE_API_KEY",
};

/**
 * Resolves each rule's model to an admin-defined provider and asks it one choice question.
 * All three kinds return a probability per option; the caller never sees provider shapes.
 */
export function createDecisionBackend(opts: {
  providers: () => readonly DecisionProvider[];
  env: Readonly<Record<string, string | undefined>>;
  /** Base URL used by a litellm provider with no baseUrl of its own. */
  gatewayUrl?: string;
  gatewayKeyHeader?: string;
  fetch?: typeof fetch;
}): DecisionBackend {
  const fetchImpl = opts.fetch ?? fetch;
  return {
    async choose({ question, state, options, model, signal }) {
      const provider = opts.providers().find((p) => p.id === model.provider);
      if (!provider) throw new Error(`decision provider ${model.provider} is not configured`);
      const base = (
        provider.baseUrl ??
        (provider.kind === "litellm" ? opts.gatewayUrl : DEFAULT_BASE[provider.kind]) ??
        ""
      ).replace(/\/$/, "");
      if (!base) throw new Error(`decision provider ${provider.id} has no base URL`);
      const keyEnv = provider.keyEnv ?? DEFAULT_KEY_ENV[provider.kind]!;
      const key = opts.env[keyEnv];
      if (!key) throw new Error(`decision provider ${provider.id}: ${keyEnv} is not set`);
      const header = provider.keyHeader ?? (provider.kind === "litellm" ? opts.gatewayKeyHeader : undefined);
      const auth: Record<string, string> = header ? { [header]: key } : { authorization: `Bearer ${key}` };
      const keys = Object.keys(options);

      if (provider.kind === "openai") {
        const body = await postJson(
          fetchImpl,
          `${base}/decisions`,
          auth,
          {
            model: model.model,
            input: state,
            questions: [
              {
                type: "choice",
                name: "decision",
                instructions: question,
                choices: keys.map((k) => ({ value: k, description: options[k] })),
              },
            ],
          },
          signal,
        );
        const answer = (body.answers as { name?: string; type?: string }[] | undefined)?.find(
          (a) => a.name === "decision",
        );
        if (answer?.type === "refusal") throw new Error("decision provider refused");
        return normalize(choiceProbabilities(answer), options);
      }

      const typesafeQuestion = { decision: { type: "choice", instructions: question, criteria: options } };
      if (provider.kind === "typesafe") {
        const body = await postJson(
          fetchImpl,
          `${base}/systemone`,
          auth,
          { state, model: model.model, questions: typesafeQuestion },
          signal,
        );
        return normalize(choiceProbabilities((body.answers as Record<string, unknown> | undefined)?.decision), options);
      }

      const body = await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        auth,
        {
          model: model.model,
          messages: [],
          typesafe: { questions: typesafeQuestion, state },
        },
        signal,
      );
      const content = (body.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { answers?: Record<string, unknown> } & Record<string, unknown>;
      return normalize(choiceProbabilities((parsed.answers ?? parsed).decision), options);
    },
  };
}
