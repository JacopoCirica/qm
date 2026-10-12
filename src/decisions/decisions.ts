const DECISION_HOOK_POINTS = {
  user_input: { actions: ["allow", "block"], decide: "most_restrictive" },
  tool_response: { actions: ["allow", "block"], decide: "most_restrictive" },
  turn_start: { actions: ["keep", "use_runtime"], decide: "most_confident" },
  goal_check: { actions: ["continue", "complete", "step_back", "pause"], decide: "most_confident" },
} as const satisfies Record<string, { actions: readonly string[]; decide: "most_restrictive" | "most_confident" }>;
export type DecisionHook = keyof typeof DECISION_HOOK_POINTS;
type DecisionAction<H extends DecisionHook = DecisionHook> = (typeof DECISION_HOOK_POINTS)[H]["actions"][number];
const DECISION_HOOKS = Object.keys(DECISION_HOOK_POINTS) as DecisionHook[];
const rank = (hook: DecisionHook, action: string) =>
  (DECISION_HOOK_POINTS[hook].actions as readonly string[]).indexOf(action);

interface RuntimeParams {
  modelId: string;
  effortLevel?: string;
  fastMode?: boolean;
}

const DECISION_PROTOCOLS = ["chat-completions", "decisions", "systemone"] as const;

export interface DecisionProvider {
  id: string;
  protocol: (typeof DECISION_PROTOCOLS)[number];
  baseUrl?: string;
  credential?: string;
}

interface DecisionModelRef {
  provider: string;
  model: string;
}

interface DecisionOption {
  description: string;
  action: DecisionAction;
  message?: string;
  runtime?: RuntimeParams;
}

export interface DecisionRule {
  id: string;
  hook: DecisionHook;
  question: string;
  options: Record<string, DecisionOption>;
  model: DecisionModelRef;
  mode: "observe" | "enforce";
  onError: string;
}

export interface DecisionResult {
  ruleId: string;
  option: string;
  action: DecisionAction;
  message?: string;
  runtime?: RuntimeParams;
  probabilities: Record<string, number>;
  mode: DecisionRule["mode"];
  error?: string;
}

interface DecisionQuestion {
  question: string;
  options: Record<string, string>;
}

export interface DecisionBackend {
  choose(input: {
    questions: Record<string, DecisionQuestion>;
    state: string;
    model: DecisionModelRef;
    signal: AbortSignal;
  }): Promise<Record<string, Record<string, number> | Error>>;
}

const RULE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_RULES = 32;
const MAX_STATE_CHARS = 16_000;

export function parseDecisionProviders(value: unknown): { providers: DecisionProvider[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "decision providers must be an array" };
  const ids = new Set<string>();
  const providers: DecisionProvider[] = [];
  for (const [i, raw] of value.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID.test(r.id)) return { error: `provider ${i}: id must match ${ID}` };
    if (ids.has(r.id)) return { error: `provider ${r.id}: duplicate id` };
    ids.add(r.id);
    if (!DECISION_PROTOCOLS.includes(r.protocol as DecisionProvider["protocol"]))
      return { error: `provider ${r.id}: protocol must be one of ${DECISION_PROTOCOLS.join(", ")}` };
    if ((r.baseUrl === undefined) !== (r.credential === undefined))
      return {
        error: `provider ${r.id}: set baseUrl and credential together, or neither to use the model gateway`,
      };
    if (r.credential !== undefined && (typeof r.credential !== "string" || !ID.test(r.credential)))
      return { error: `provider ${r.id}: credential must name an org service credential` };
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
    providers.push({
      id: r.id,
      protocol: r.protocol as DecisionProvider["protocol"],
      ...(r.baseUrl !== undefined ? { baseUrl: String(r.baseUrl), credential: r.credential as string } : {}),
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
      if (!ID.test(key)) return { error: `${r.id}: option ${key} must match ${ID}` };
      const o = opt as Record<string, unknown> | null;
      if (typeof o?.description !== "string" || !o.description.trim())
        return { error: `${r.id}.${key}: description is required` };
      const allowed = DECISION_HOOK_POINTS[r.hook as DecisionHook].actions as readonly string[];
      if (!allowed.includes(o.action as string))
        return { error: `${r.id}.${key}: action at ${String(r.hook)} must be one of ${allowed.join(", ")}` };
      if (o.message !== undefined && typeof o.message !== "string") return { error: `${r.id}.${key}: bad message` };
      const rt = o.runtime as Record<string, unknown> | undefined;
      if ((o.action === "use_runtime") !== (rt !== undefined))
        return { error: `${r.id}.${key}: runtime is required with use_runtime and only allowed there` };
      if (
        rt &&
        (typeof rt.modelId !== "string" ||
          !rt.modelId.trim() ||
          (rt.effortLevel !== undefined && typeof rt.effortLevel !== "string") ||
          (rt.fastMode !== undefined && typeof rt.fastMode !== "boolean"))
      )
        return { error: `${r.id}.${key}: runtime needs modelId and optional effortLevel/fastMode` };
      options[key] = {
        description: o.description,
        action: o.action as DecisionAction,
        ...(o.message ? { message: o.message } : {}),
        ...(rt
          ? {
              runtime: {
                modelId: rt.modelId as string,
                ...(rt.effortLevel !== undefined ? { effortLevel: rt.effortLevel as string } : {}),
                ...(rt.fastMode !== undefined ? { fastMode: rt.fastMode as boolean } : {}),
              },
            }
          : {}),
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

function pick(rule: DecisionRule, probabilities: Record<string, number>): string {
  let best = rule.onError;
  let bestP = -1;
  for (const [key, opt] of Object.entries(rule.options)) {
    const p = probabilities[key] ?? 0;
    const restrictive = rank(rule.hook, opt.action) > rank(rule.hook, rule.options[best]!.action);
    if (p > bestP || (p === bestP && restrictive)) {
      best = key;
      bestP = p;
    }
  }
  return best;
}

function errorChain(error: unknown): string {
  const parts: string[] = [];
  for (let e = error, depth = 0; e !== undefined && depth < 5; depth++) {
    parts.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(" <- ").slice(0, 2_000);
}

function settle(rule: DecisionRule, answer: Record<string, number> | Error | undefined): DecisionResult {
  let error: string | undefined;
  if (answer instanceof Error) error = errorChain(answer);
  else if (!answer) error = "classifier returned no answer";
  const probabilities = answer && !(answer instanceof Error) ? answer : {};
  const option = error ? rule.onError : pick(rule, probabilities);
  const opt = rule.options[option]!;
  return {
    ruleId: rule.id,
    option,
    action: opt.action,
    ...(opt.message ? { message: opt.message } : {}),
    ...(opt.runtime ? { runtime: opt.runtime } : {}),
    probabilities,
    mode: rule.mode,
    ...(error ? { error } : {}),
  };
}

async function runGroup(
  rules: readonly DecisionRule[],
  state: string,
  backend: DecisionBackend,
  signal: AbortSignal,
): Promise<DecisionResult[]> {
  let answers: Record<string, Record<string, number> | Error>;
  try {
    answers = await backend.choose({
      questions: Object.fromEntries(
        rules.map((r) => [
          r.id,
          {
            question: r.question,
            options: Object.fromEntries(Object.entries(r.options).map(([k, o]) => [k, o.description])),
          },
        ]),
      ),
      state: state.slice(0, MAX_STATE_CHARS).toWellFormed(),
      model: rules[0]!.model,
      signal,
    });
  } catch (error) {
    return rules.map((r) => settle(r, error instanceof Error ? error : new Error(String(error))));
  }
  return rules.map((r) => settle(r, answers[r.id]));
}

export async function runHook(
  rules: readonly DecisionRule[],
  hook: DecisionHook,
  state: string,
  backend: DecisionBackend,
  signal: AbortSignal,
): Promise<{ decisive?: DecisionResult; results: DecisionResult[] }> {
  const groups = new Map<string, DecisionRule[]>();
  for (const rule of rules.filter((r) => r.hook === hook)) {
    const key = JSON.stringify([rule.model.provider, rule.model.model]);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  const results = (await Promise.all([...groups.values()].map((g) => runGroup(g, state, backend, signal)))).flat();
  const confident = DECISION_HOOK_POINTS[hook].decide === "most_confident";
  const weight = (r: DecisionResult) =>
    confident && !r.error ? (r.probabilities[r.option] ?? 0) : rank(hook, r.action);
  let decisive: DecisionResult | undefined;
  for (const result of results) {
    if (result.mode !== "enforce" || (confident && result.error)) continue;
    if (!decisive || weight(result) > weight(decisive)) decisive = result;
  }
  return { ...(decisive ? { decisive } : {}), results };
}

const sample = (value: unknown) =>
  String((typeof value === "string" ? value : JSON.stringify(value)) ?? value).slice(0, 500);

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`classifier returned invalid JSON: ${sample(text)}`, { cause: error });
  }
}

function normalize(
  probabilities: Record<string, unknown>,
  options: Record<string, string>,
  response: unknown,
): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const key of Object.keys(options)) {
    const p = probabilities[key];
    if (p !== undefined && (typeof p !== "number" || !Number.isFinite(p) || p < 0))
      throw new Error(
        `classifier returned an invalid probability for ${key}: ${String(JSON.stringify(p) ?? p).slice(0, 200)}`,
      );
    out[key] = p ?? 0;
    total += p ?? 0;
  }
  if (total <= 0) throw new Error(`classifier returned no usable probabilities: ${sample(response)}`);
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
  return parseJson(text);
}

function choiceProbabilities(answer: unknown): Record<string, unknown> {
  const a = (answer ?? {}) as { probabilities?: unknown };
  if (Array.isArray(a.probabilities)) {
    return Object.fromEntries(
      (a.probabilities as { value?: unknown; probability?: unknown }[]).map((p) => [String(p.value), p.probability]),
    );
  }
  return (a.probabilities ?? {}) as Record<string, unknown>;
}

type Questions = Record<string, DecisionQuestion>;
const typesafeQuestions = (questions: Questions) =>
  Object.fromEntries(
    Object.entries(questions).map(([k, q]) => [k, { type: "choice", instructions: q.question, criteria: q.options }]),
  );
const byKey = (answers: unknown) => (k: string) => ((answers ?? {}) as Record<string, unknown>)[k];

/** Each wire protocol maps one request/response shape onto questions in, per-option probabilities out. */
const PROTOCOLS: Record<
  DecisionProvider["protocol"],
  {
    path: string;
    request: (model: string, questions: Questions, state: string) => unknown;
    answers: (body: Record<string, unknown>) => (key: string) => unknown;
  }
> = {
  decisions: {
    path: "/decisions",
    request: (model, questions, state) => ({
      model,
      input: state,
      questions: Object.entries(questions).map(([name, q]) => ({
        type: "choice",
        name,
        instructions: q.question,
        choices: Object.entries(q.options).map(([value, description]) => ({ value, description })),
      })),
    }),
    answers: (body) => (k) => ((body.answers as { name?: string }[] | undefined) ?? []).find((a) => a.name === k),
  },
  systemone: {
    path: "/systemone",
    request: (model, questions, state) => ({ state, model, questions: typesafeQuestions(questions) }),
    answers: (body) => byKey(body.answers),
  },
  "chat-completions": {
    path: "/chat/completions",
    request: (model, questions, state) => ({
      model,
      messages: [],
      typesafe: { questions: typesafeQuestions(questions), state },
    }),
    answers: (body) => {
      const content = (body.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error(`classifier returned no message content: ${sample(body)}`);
      const parsed = parseJson(content);
      return byKey(parsed.answers ?? parsed);
    },
  },
};

export function createDecisionBackend(opts: {
  providers: () => readonly DecisionProvider[];
  gateway?: { url: string; apiKey: string; apiKeyHeader?: string };
  credential: (slug: string) => Promise<{ host: string; enabled: boolean; header: [string, string] } | null>;
  fetch?: typeof fetch;
}): DecisionBackend {
  const fetchImpl = opts.fetch ?? fetch;
  const endpoint = async (provider: DecisionProvider): Promise<{ base: string; auth: Record<string, string> }> => {
    if (!provider.baseUrl) {
      if (!opts.gateway) throw new Error(`decision provider ${provider.id}: no model gateway is configured`);
      const header = opts.gateway.apiKeyHeader;
      return {
        base: opts.gateway.url.replace(/\/$/, ""),
        auth: header ? { [header]: opts.gateway.apiKey } : { authorization: `Bearer ${opts.gateway.apiKey}` },
      };
    }
    const rec = await opts.credential(provider.credential!);
    if (!rec?.enabled)
      throw new Error(`decision provider ${provider.id}: credential ${provider.credential} is missing or disabled`);
    const url = new URL(provider.baseUrl);
    if (url.host !== rec.host)
      throw new Error(
        `decision provider ${provider.id}: credential ${provider.credential} is for ${rec.host}, not ${url.host}`,
      );
    return { base: provider.baseUrl.replace(/\/$/, ""), auth: { [rec.header[0]]: rec.header[1] } };
  };
  return {
    async choose({ questions, state, model, signal }) {
      const provider = opts.providers().find((p) => p.id === model.provider);
      if (!provider) throw new Error(`decision provider ${model.provider} is not configured`);
      const { base, auth } = await endpoint(provider);
      const keys = Object.keys(questions);
      const wire = PROTOCOLS[provider.protocol];
      const body = await postJson(
        fetchImpl,
        `${base}${wire.path}`,
        auth,
        wire.request(model.model, questions, state),
        signal,
      );
      const answers = wire.answers(body);
      return Object.fromEntries(
        keys.map((k) => {
          try {
            const answer = answers(k);
            if ((answer as { type?: string } | undefined)?.type === "refusal")
              throw new Error(`decision provider refused: ${sample(answer)}`);
            return [k, normalize(choiceProbabilities(answer), questions[k]!.options, body)];
          } catch (error) {
            return [k, error instanceof Error ? error : new Error(String(error))];
          }
        }),
      );
    },
  };
}
