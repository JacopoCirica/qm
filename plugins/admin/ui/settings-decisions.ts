import { mountTemplate } from "./shared.ts";
import { html } from "lit";
import { classMap } from "lit/directives/class-map.js";
let config: any;
const PROTOCOLS = ["chat-completions", "decisions", "systemone"];
const state = {
  scope: "",
  data: null as any,
  provider: { id: "", protocol: "chat-completions", baseUrl: "", credential: "" },
  rule: null as any,
  saving: false,
  message: "",
};
let redraw = () => {};
export function configureDecisions(options: any) {
  config = options;
}
export function loadDecisions(data: any, scope: string) {
  state.scope = scope;
  state.data = scope.startsWith("org:") ? data.decisions || null : null;
  state.rule = null;
  state.message = "";
  redraw();
}
const hookActions = (hook: string) => state.data.hooks.find((h: any) => h.id === hook)?.actions || [];
function blankRule() {
  const hook = state.data.hooks[0]?.id || "";
  const [first, second] = hookActions(hook);
  return {
    id: "",
    hook,
    question: "",
    provider: state.data.providers[0]?.id || "",
    model: "",
    mode: "observe",
    enabled: true,
    onError: "a",
    options: [
      { key: "a", description: "", action: first, modelId: "", effortLevel: "", fastMode: false },
      { key: "b", description: "", action: second || first, modelId: "", effortLevel: "", fastMode: false },
    ],
  };
}
function editRule(r: any) {
  state.rule = {
    id: r.id,
    hook: r.hook,
    question: r.question,
    provider: r.model.provider,
    model: r.model.model,
    mode: r.mode,
    enabled: r.enabled,
    onError: r.onError,
    options: Object.entries(r.options).map(([key, o]: [string, any]) => ({
      key,
      description: o.description,
      action: o.action,
      modelId: o.runtime?.modelId || "",
      effortLevel: o.runtime?.effortLevel || "",
      fastMode: o.runtime?.fastMode || false,
    })),
  };
  redraw();
}
function ruleBody(d: any) {
  return {
    id: d.id,
    hook: d.hook,
    question: d.question,
    model: { provider: d.provider, model: d.model },
    mode: d.mode,
    enabled: d.enabled,
    onError: d.onError,
    options: Object.fromEntries(
      d.options.map((o: any) => [
        o.key,
        {
          description: o.description,
          action: o.action,
          ...(o.action === "use_runtime"
            ? {
                runtime: {
                  modelId: o.modelId,
                  ...(o.effortLevel ? { effortLevel: o.effortLevel } : {}),
                  ...(o.fastMode ? { fastMode: true } : {}),
                },
              }
            : {}),
        },
      ]),
    ),
  };
}
async function send(body: any, done: () => void) {
  const scope = state.scope;
  state.saving = true;
  state.message = "Saving…";
  redraw();
  try {
    const result = await config.save(scope, body);
    if (scope !== state.scope) return;
    if (!result.ok) state.message = result.error || result.data?.message || "Save failed.";
    else {
      done();
      state.message = "Saved.";
    }
  } catch {
    state.message = "Could not save. Try again.";
  } finally {
    state.saving = false;
    redraw();
  }
}
const upsert = (list: any[], item: any) =>
  [...list.filter((x) => x.id !== item.id), item].sort((a, b) => (a.id < b.id ? -1 : 1));
function saveProvider() {
  const p = state.provider;
  const provider = {
    id: p.id,
    protocol: p.protocol,
    ...(p.baseUrl ? { baseUrl: p.baseUrl, credential: p.credential } : {}),
  };
  void send({ provider }, () => {
    state.data.providers = upsert(state.data.providers, provider);
    state.provider = { id: "", protocol: "chat-completions", baseUrl: "", credential: "" };
  });
}
function saveRule(rule: any) {
  void send({ rule }, () => {
    state.data.rules = upsert(state.data.rules, rule);
    state.rule = null;
  });
}
function remove(kind: "Provider" | "Rule", id: string) {
  void send({ [`remove${kind}`]: id }, () => {
    const key = kind === "Provider" ? "providers" : "rules";
    state.data[key] = state.data[key].filter((x: any) => x.id !== id);
  });
}
const field = (label: string, value: string, set: (v: string) => void, attrs = "") =>
  html`<label
    >${label}<input
      .value=${value}
      placeholder=${attrs}
      @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
  /></label>`;
const select = (label: string, value: string, values: readonly string[], set: (v: string) => void) =>
  html`<label
    >${label}<select .value=${value} @change=${(e: Event) => (set((e.target as HTMLSelectElement).value), redraw())}>
      ${values.map((v) => html`<option value=${v} ?selected=${v === value}>${v}</option>`)}
    </select></label
  >`;
function ruleForm() {
  const d = state.rule;
  const actions = hookActions(d.hook);
  const models = state.data.models.map((m: any) => m.id);
  return html`<div class="decision-rule-form">
    ${field("Rule id", d.id, (v) => (d.id = v), "e.g. hard-tasks")}
    ${select(
      "Hook",
      d.hook,
      state.data.hooks.map((h: any) => h.id),
      (v) => {
        d.hook = v;
        for (const o of d.options) if (!hookActions(v).includes(o.action)) o.action = hookActions(v)[0];
      },
    )}
    <label
      >Question<textarea
        .value=${d.question}
        @input=${(e: Event) => (d.question = (e.target as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
    ${select(
      "Decision provider",
      d.provider,
      state.data.providers.map((p: any) => p.id),
      (v) => (d.provider = v),
    )}
    ${field("Decision model", d.model, (v) => (d.model = v), "model served by the provider")}
    ${select("Mode", d.mode, ["observe", "enforce"], (v) => (d.mode = v))}
    ${d.options.map(
      (o: any, i: number) =>
        html`<fieldset class="decision-option">
          ${field("Option", o.key, (v) => (o.key = v))}
          ${field("Description", o.description, (v) => (o.description = v))}
          ${select("Action", o.action, actions, (v) => (o.action = v))}
          ${
            o.action === "use_runtime"
              ? html`${select("Model", o.modelId, ["", ...models], (v) => (o.modelId = v))}
                  ${field("Effort", o.effortLevel, (v) => (o.effortLevel = v), "optional")}
                  <label class="setting-toggle"
                    ><input
                      type="checkbox"
                      .checked=${o.fastMode}
                      @change=${(e: Event) => (o.fastMode = (e.target as HTMLInputElement).checked)}
                    />Fast mode</label
                  >`
              : ""
          }
          ${
            d.options.length > 2
              ? html`<button class="danger" @click=${() => (d.options.splice(i, 1), redraw())}>Remove option</button>`
              : ""
          }
        </fieldset>`,
    )}
    <button
      @click=${() => (
        d.options.push({ key: "", description: "", action: actions[0], modelId: "", effortLevel: "", fastMode: false }),
        redraw()
      )}
    >
      + Option
    </button>
    ${select(
      "On error",
      d.onError,
      d.options.map((o: any) => o.key),
      (v) => (d.onError = v),
    )}
    <div>
      <button class="primary" ?disabled=${state.saving} @click=${() => saveRule(ruleBody(d))}>Save rule</button>
      <button @click=${() => ((state.rule = null), redraw())}>Cancel</button>
    </div>
  </div>`;
}
function template() {
  const data = state.data;
  return html`<section class=${classMap({ card: true, "sv-customize": true, hidden: !data })} id="card-decisions">
    <div class="head">
      <h2>Decision rules</h2>
      <p>
        Classifiers that run at harness hooks. A rule asks its decision model a question, picks an option, and applies
        that option's action. Observe rules only log their verdicts.
      </p>
    </div>
    ${
      data
        ? html`<div class="body">
              <h3>Providers</h3>
              ${data.providers.map(
                (p: any) =>
                  html`<div class="feature-flag-row">
                    <code
                      >${p.id}:
                      ${p.protocol}${p.baseUrl ? ` · ${p.baseUrl} · ${p.credential}` : " · model gateway"}</code
                    ><button class="danger" ?disabled=${state.saving} @click=${() => remove("Provider", p.id)}>
                      Remove
                    </button>
                  </div>`,
              )}
              <div class="decision-provider-form">
                ${field("Provider id", state.provider.id, (v) => (state.provider.id = v))}
                ${select("Protocol", state.provider.protocol, PROTOCOLS, (v) => (state.provider.protocol = v))}
                ${field("Base URL", state.provider.baseUrl, (v) => (state.provider.baseUrl = v), "blank uses the model gateway")}
                ${field("Credential", state.provider.credential, (v) => (state.provider.credential = v), "org service credential")}
                <button ?disabled=${state.saving || !state.provider.id} @click=${saveProvider}>Save provider</button>
              </div>
              <h3>Rules</h3>
              ${data.rules.length ? "" : html`<div class="hint">No rules yet.</div>`}
              ${data.rules.map(
                (r: any) =>
                  html`<div class="feature-flag-row">
                    <code>${r.id}: ${r.hook} · ${r.mode}${r.enabled ? "" : " · off"}</code>
                    <span>
                      <button ?disabled=${state.saving} @click=${() => saveRule({ ...r, enabled: !r.enabled })}>
                        ${r.enabled ? "Turn off" : "Turn on"}
                      </button>
                      <button ?disabled=${state.saving} @click=${() => editRule(r)}>Edit</button>
                      <button class="danger" ?disabled=${state.saving} @click=${() => remove("Rule", r.id)}>
                        Remove
                      </button>
                    </span>
                  </div>`,
              )}
              ${state.rule ? ruleForm() : ""}
            </div>
            <div class="foot">
              <button
                class="primary"
                ?disabled=${state.saving || !!state.rule || !data.providers.length}
                @click=${() => ((state.rule = blankRule()), redraw())}
              >
                + Add rule</button
              ><span class="status">${state.message}</span>
            </div>`
        : ""
    }
  </section>`;
}
export function mountDecisions() {
  redraw = mountTemplate('template[data-settings-card="card-decisions"]', template);
}
