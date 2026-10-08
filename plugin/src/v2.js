'use strict';

/**
 * v2 entrypoint (loaded from package root `/index.js`; v2 ignores `main`).
 * Plain `{ id, setup }` object — `Plugin.define()` is only a type helper,
 * so zero dependencies are needed.
 *
 * Model routing verified against @opencode/plugin 2.0.x + @opencode/schema:
 * - `SessionRequest.model` is `Model.Ref = { id, providerID, variant? }`
 *   (note: `id`, not `modelID`). The session stays on its virtual anchor
 *   for its whole life: `event.model` is never mutated to a real pick
 *   (that would dispatch past the proxy on the wrong driver) and
 *   `ctx.session.switchModel` is never called for routing — the picker
 *   choice IS the route and it never moves.
 * - Only the `context` (agent loop) hook is routed. `title`/`compaction`/
 *   `generate` requests intentionally keep their own models so cheap
 *   auxiliary calls stay cheap.
 * - The chat-visible announce line (`announce` option, default `switch`)
 *   is appended to `event.prompt.text` in the `prompt` hook (v2
 *   `PromptInput.Prompt = { text, files?, agents?, skills? }`): v2 has no
 *   zero-token visible channel (`context` edits never render), so the
 *   terse line persists+renders (~15 tokens/turn). The prompt hook event
 *   carries no `agent` field — the agent tag is read from prompt mentions.
 * - Routing switch = the virtual model; router sync = its own toggle: both
 *   hooks first sync OpenChamber's `routing.json` (shared
 *   `./shared/routing.js`, best-effort — a machine without
 *   `~/.config/openchamber` is a silent no-op) unless the router-sync
 *   switch is off (`<cacheDir>/routing-sync.json`, default on), then only
 *   sessions on a `modelselect` virtual model route/announce — any other
 *   model is the user's hands-off choice (no announce or status — the
 *   session model is never switched anymore). The plugin no longer depends on OpenChamber: routing.json is only kept in
 *   sync so an installed OpenChamber follows along.
 * - Free-tier fail-soft (`http.response` + `retry` hooks): Zen publishes
 *   no free-quota endpoint (anomalyco/opencode#18648), so exhaustion is
 *   detected from the real failed request — no dummy probe. A free-side
 *   `primary` response matching the fingerprints in `./shared/
 *   freequota.js` registers a PER-MODEL latch (`.opencode/.modelselect-
 *   cache/free-quota.json`): spent quota uses 12h, transient rate
 *   limiting uses 1h, and only the failing model is suspended — its
 *   siblings keep routing free. Routing sync + `resolveModel` then prefer
 *   `go` for tasks on that model, and the failing session arms exactly
 *   one forced retry so the turn resumes on the paid alternative through
 *   the proxy (the retry re-resolves through the same routing headers —
 *   the session model itself never moves). The latch expires after its
 *   first-detection window (never extended), allowing a new check;
 *   non-virtual sessions and `suggestOnly` still latch + resync routing
 *   (while the router sync is on) but never arm the retry.
 * - Host detection (`./shared/host.js`): explicit `openchamber` option →
 *   `MODELSELECT_OPENCHAMBER` env → extension-written session map →
 *   standalone. Display/status only (`/modelselect`); per-turn routing
 *   keys off `event.model` directly and the virtual model registers in
 *   every host.
 * - Virtual provider `modelselect` (every host): a single provider owned
 *   by this plugin with one model per `autoPreference` —
 *   `modelselect/auto-free-first` pins free-first, `modelselect/auto-go-
 *   first` pins go-first — THE routing switch (the on/off/auto modes are
 *   gone): a session on either is routed every turn, any other model is
 *   hands-off. The provider's baseURL points at a localhost proxy started
 *   in `setup` (see `./proxy.js`), which forwards each request to the
 *   real Zen/Go base — THAT is what routes, because the dispatch endpoint
 *   stays pinned to the session provider and the two real bases differ
 *   (verified live). The session always stays on its virtual anchor (the
 *   model picker IS the switch) while the `http.request` hook stamps the
 *   resolved pick into routing headers + body per physical attempt. There
 *   are no anchor hops and no leaving virtual mode: every pick, whatever
 *   its provider, flows through the same proxy. Free-exhaustion on a
 *   virtual session arms the forced retry without ever moving the session;
 *   the armed retry re-resolves through the same headers, where the fresh
 *   latch prefers go.
 * - Thinking level: the two virtual models register the six config
 *   think levels (`default|minimal|low|medium|high|xhigh`) as picker
 *   variants, and the per-turn task `think` hint syncs onto the virtual
 *   entry's `settings.reasoningEffort` + `body.reasoning_effort`
 *   (same wanted-state pattern as the protocol `api` patch). The task
 *   hint is therefore the dispatch default; a manual variant on the
 *   session ref wins because the host's `withVariant` merges variant
 *   settings/body OVER the model's per dispatch, and `default` maps to
 *   no overlay — so picking `default` = follow the task hint. Effort
 *   fields ride the body untouched through the `http.request` rewrite
 *   and the proxy (both only touch `body.model`).
 * - `/modelselect` chat command (`ctx.command.transform`): no argument
 *   prints router-sync state + host + last pick; `sync on|off` writes the
 *   router-sync switch via `shared/status.js writeRoutingSync`. Output
 *   prefers `ctx.session.synthetic`
 *   (no model turn) with `ctx.session.prompt` as fallback.
 *
 * v2-only: the v1 `server()` entry was removed — this package now requires
 * OpenCode v2.
 */

const path = require('node:path');
const { detectRepoSignals } = require('./shared/detect');
const { normalizeThink } = require('./shared/core/lookup');
const { refineTaskTypeWithJev, jevLabel } = require('./shared/jev');
const {
  resolveWithHistory,
  shouldRemember,
  continuationState,
  lastAssistantSnippet,
  truncate,
} = require('./shared/continuation');
const { normalizeOptions, resolveModel, splitModelRef, formatAnnounce, shouldAnnounce, loadConfig } = require('./shared/select');
const { readRoutingSync, writeRoutingSync, writeStatus, statusFile } = require('./shared/status');
const { resolveHost, sessionMapHit, sessionMapAnyHit, SESSION_MAP_FILE, SESSION_MAP_TTL_MS } = require('./shared/host');
const { syncRouting } = require('./shared/routing');
const { createRoutingIo } = require('./shared/routing-io');
const {
  classifyFreeFailure,
  isFreeModelRef,
  isFreeQuotaFresh,
  isProtocolMismatch,
  markFreeQuota,
  mismatchHaystack,
  readModelTable,
} = require('./shared/freequota');

const { startProxy, HEADER_PROVIDER, HEADER_MODEL, HEADER_ENDPOINT } = require('./proxy');
const { resolveToken } = require('./shared/auth');

const ID = 'modelselect';
// Single virtual provider: `modelselect` owns one model per
// `autoPreference` (`auto-free-first` pins free-first, `auto-go-first`
// pins go-first). The provider's baseURL points at a localhost proxy
// started by this plugin, which forwards each request to the real Zen/Go
// base — the dispatch endpoint stays pinned to the session provider by
// design, so the virtual provider IS its own endpoint (live-verified:
// `opencode` and `opencode-go` use different bases, so no static driver
// could cover both). Selecting either model routes every turn but never
// persists the real pick. The session always stays virtual — there are no
// anchor hops and no leaving virtual mode anymore.
const VIRTUAL_PROVIDER = 'modelselect';
const VIRTUAL_FREE = 'auto-free-first';
const VIRTUAL_GO = 'auto-go-first';
const VIRTUAL_MODELS = [VIRTUAL_FREE, VIRTUAL_GO];
const VIRTUAL_REF = `${VIRTUAL_PROVIDER}/${VIRTUAL_FREE}`;
// The six reasoning-effort levels from config/task-types.yaml, offered as
// picker variants on both virtual models. `default` carries no overlay (the
// host maps variant "default" to no merge), the rest overlay the effort onto
// the outgoing request — `settings` for the driver-normalized spell and the
// raw `body` key as the guaranteed passthrough (both converge to the same
// `reasoning_effort` field on the chat protocol the virtual models dispatch
// with, so applying both is idempotent).
const THINK_VARIANTS = ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'];
// Live-captured upstream bases, refreshed on every catalog materialize.
// Hardcoded fallbacks are the live-verified Zen/Go inference bases.
const FALLBACK_UPSTREAM = {
  opencode: { baseURL: 'https://opencode.ai/inference/openai/v1' },
  'opencode-go': { baseURL: 'https://opencode.ai/inference/go/openai/v1' },
};
// Wire-protocol token (config `endpoints` map) → AI SDK package. The
// catalog model's `api` drives OpenCode's route selection — URL path, body
// serializer and stream decoder all come from it — so pointing the virtual
// `auto` entry's `api` at the pick's protocol puts /responses-only picks
// (e.g. muse-spark-1.3-*, GPT-6 Luna) on the right Zen endpoint instead of
// inheriting the provider default chat/completions, which those models
// reject with ModelProtocolUnsupported. Unknown/absent tokens keep the
// provider default.
const ENDPOINT_PACKAGES = {
  responses: '@ai-sdk/openai',
  messages: '@ai-sdk/anthropic',
  chat: '@ai-sdk/openai-compatible',
};
// Forced-retry arm window: a retry follows its failure within seconds, so
// an arm older than this (consumed late) is stale and must not fire.
const FREE_RETRY_TTL_MS = 60 * 1000;
// Protocol-mismatch arm window: the one-shot fail-soft retry must not stick
// forever — a retried turn that succeeds leaves its arm behind, and without
// a TTL that stale arm would swallow the next independent mismatch. Arms
// older than this are treated as absent (a fresh mismatch retries again).
const PROTOCOL_RETRY_TTL_MS = 60 * 1000;

// Fallback virtual limits: the session stays on a virtual `auto` anchor, so
// OpenCode drives its compaction threshold off the virtual
// `limit.context`. It must stay large (never the smallest pick), otherwise
// a session compacts early and the compaction request can dispatch the
// raw `auto` id (`invalid model`). Live maxima win when larger.
const FALLBACK_VIRTUAL_LIMIT = { context: 2000000, output: 128000 };

/** Max positive finite number in a list, or null when none qualifies. */
function maxPositive(values) {
  let best = null;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/**
 * Virtual `limit` for a live inventory snapshot: the max live
 * `limit.context`/`limit.output`, floored at the large fallback so a
 * small/empty inventory can never shrink the virtual window. `models`
 * excludes the virtual entry itself (pass the filtered list) to keep
 * transform replays idempotent.
 */
function virtualLimitFor(models) {
  const list = Array.isArray(models) ? models : [];
  const liveContext = maxPositive(list.map((m) => m?.limit?.context));
  const liveOutput = maxPositive(list.map((m) => m?.limit?.output));
  return {
    context: Math.max(FALLBACK_VIRTUAL_LIMIT.context, liveContext ?? 0),
    output: Math.max(FALLBACK_VIRTUAL_LIMIT.output, liveOutput ?? 0),
  };
}

/** Is this Model.Ref a virtual pick on the single virtual provider? */
function isVirtualRef(ref) {
  return Boolean(
    ref &&
      typeof ref === 'object' &&
      ref.providerID === VIRTUAL_PROVIDER &&
      VIRTUAL_MODELS.includes(ref.id),
  );
}

/** Preference pinned by a virtual model id (`auto-go-first` → go-first). */
function preferenceForVirtualId(id) {
  return String(id) === VIRTUAL_GO ? 'go-first' : 'free-first';
}

/**
 * Which ref actually failed on the wire. Real (non-virtual) event models
 * win — they name the side that failed (e.g. a go-side 429 must not latch
 * the free pick). Virtual anchors carry no side, so fall back to the
 * session's last resolved pick; when nothing is known, use the event
 * model itself.
 */
function refForFailure(sessionID, eventModel, virtualSessions, lastVirtualPick) {
  if (eventModel && typeof eventModel === 'object' && !isVirtualRef(eventModel)) return eventModel;
  if (sessionID && virtualSessions && virtualSessions.has(sessionID) && lastVirtualPick) {
    const pick = lastVirtualPick.get(sessionID);
    if (pick) return pick;
  }
  return eventModel;
}

function cacheDirFor(directory) {
  return path.join(String(directory || process.cwd()), '.opencode', '.modelselect-cache');
}

function scanRepo(directory) {
  const fs = require('node:fs');
  const root = String(directory || process.cwd());
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).map((d) => d.name);
  } catch {
    return {};
  }
  const has = (...xs) => xs.some((x) => names.includes(x));
  return {
    stackFiles: names.filter((n) =>
      ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'pom.xml'].includes(n),
    ),
    hasUI: has('tailwind.config.js', 'components') || names.some((n) => /\.(tsx|vue)$/.test(n)),
    hasE2E: has('playwright.config.ts', 'cypress.config.ts') || names.includes('e2e'),
    hasMech: names.some((n) => /\.(scad|stl|step|stp)$/i.test(n)),
  };
}

function promptTextFromMessages(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .flatMap((m) => m?.parts ?? m?.content ?? [])
    .filter((p) => (typeof p === 'string' ? true : p?.type === 'text'))
    .map((p) => (typeof p === 'string' ? p : p.text))
    .join('\n');
}

// v2 `prompt` hook carries `PromptInput.Prompt = { text, files?, agents?,
// skills? }` — not a string and not `{ parts }`. Older shapes (plain string,
// `{ parts }`, `{ content }`) are kept as fallback so tests and any other
// host keep working.
function promptTextFromPrompt(prompt) {
  if (typeof prompt === 'string') return prompt;
  if (prompt && typeof prompt === 'object') {
    if (typeof prompt.text === 'string') return prompt.text;
    if (Array.isArray(prompt.parts)) return promptTextFromMessages([prompt]);
    if (typeof prompt.content === 'string') return prompt.content;
  }
  return '';
}

// File signals from a v2 prompt: `{ uri, name? }` entries. Basename-ish
// strings are enough for the heuristics (they match on extensions/names).
function filesFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'object' || !Array.isArray(prompt.files)) return [];
  return prompt.files.flatMap((f) => {
    if (!f || typeof f !== 'object') return [];
    const cands = [f.name, f.uri];
    return cands.filter((c) => typeof c === 'string' && c);
  });
}

// The v2 prompt hook event has no `agent` field; agent mentions arrive as
// `prompt.agents = [{ name }]`. First mention wins (single-agent sessions).
function agentFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'object' || !Array.isArray(prompt.agents)) return undefined;
  const first = prompt.agents.find((a) => a && typeof a.name === 'string' && a.name);
  return first ? first.name : undefined;
}

async function setup(ctx) {
  const opts = normalizeOptions(ctx.options ?? {}, process.env);
  const directory = ctx.location?.directory ?? process.cwd();
  const cacheDir = cacheDirFor(directory);
  const routingIo = createRoutingIo(directory);
  const repo = detectRepoSignals(scanRepo(directory));
  const host = resolveHost({
    options: opts,
    env: process.env,
    hasSessionHit: () => sessionMapAnyHit(cacheDir),
  });
  const rawOptions = ctx.options ?? {};
  const prompts = new Map(); // sessionID -> last prompt text
  const applied = new Map(); // sessionID -> "provider/id" already persisted
  const announced = new Map(); // sessionID -> last announced "provider/id" key
  const history = new Map(); // sessionID -> { task, prompt } last substantive turn
  const freeFlipped = new Set(); // sessions already flipped to go (process lifetime)
  const freeRetry = new Map(); // sessionID -> armedAt (epoch ms): one forced retry
  const protocolRetry = new Map(); // sessionID -> armedAt: one re-synced retry after a protocol mismatch
  const virtualSessions = new Set(); // sessions whose current model is a virtual anchor
  const virtualIds = new Map(); // sessionID -> virtual model id (pins the preference)
  const lastVirtualPick = new Map(); // sessionID -> { providerID, id }: last resolved pick, for aux requests
  const upstream = new Map(); // providerID -> { baseURL, headers }: live-captured, refreshed per materialize
  const registrations = []; // provider/command transform registrations (disposed on cleanup)
  let proxy = null; // localhost forwarder; sessions dispatch through it, it forwards to Zen/Go

  // Refresh the upstream map from a live catalog snapshot: baseURL +
  // headers (org id) per real provider. Runs inside every provider
  // transform replay, so the proxy always forwards to fresh values.
  // Unknown providers fall back to the live-verified bases (headers {}).
  function captureUpstream(editor) {
    try {
      if (typeof editor.get !== 'function') return;
      for (const providerID of Object.keys(FALLBACK_UPSTREAM)) {
        const live = editor.get(providerID);
        const info = live && live.provider ? live.provider : null;
        const baseURL =
          (info && info.settings && typeof info.settings.baseURL === 'string' && info.settings.baseURL) ||
          FALLBACK_UPSTREAM[providerID].baseURL;
        const headers =
          info && info.headers && typeof info.headers === 'object' ? { ...info.headers } : {};
        upstream.set(providerID, { baseURL, headers });
      }
    } catch {
      // never break setup
    }
  }

  function upstreamFor(providerID) {
    return upstream.get(providerID) || FALLBACK_UPSTREAM[providerID] || null;
  }

  // Single virtual provider, auto-registered here in EVERY host — the
  // picker always shows routing. `modelselect` owns one model per
  // auto-preference and points at the plugin's localhost proxy (started
  // below — the port must exist before registration). The proxy forwards
  // each request to the real Zen/Go base, so cross-provider picks need no
  // anchor hop and sessions never leave virtual mode. Registration is
  // idempotent (remove + add on every replay). The virtual `limit` stays
  // at the large fallback: OpenCode compacts off the SESSION model's
  // window, and a small virtual window would compact early. The model
  // literals mirror @opencode/schema's `Model.Info.default(providerID,
  // id)` — copied here because the package is zero-dependency. Without a
  // provider transform API the rest of the plugin still resolves and
  // announces, but nothing can dispatch through the virtual models:
  // failures only log.
  function virtualModelEntry(id, name) {
    return {
      id,
      modelID: id,
      providerID: VIRTUAL_PROVIDER,
      name,
      capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
      variants: THINK_VARIANTS.map((level) =>
        level === 'default'
          ? { id: level }
          : { id: level, settings: { reasoningEffort: level }, body: { reasoning_effort: level } },
      ),
      time: { released: 0 },
      cost: [],
      status: 'active',
      enabled: true,
      limit: { ...FALLBACK_VIRTUAL_LIMIT },
    };
  }

  function registerVirtual(editor) {
    captureUpstream(editor);
    if (typeof editor.add !== 'function') return;
    if (typeof editor.remove === 'function') {
      try {
        editor.remove(VIRTUAL_PROVIDER);
      } catch {
        // absent or frozen: the add below still tries
      }
    }
    let baseURL = null;
    try {
      baseURL = proxy ? `http://127.0.0.1:${proxy.port}/v1` : null;
    } catch {
      baseURL = null;
    }
    if (!baseURL) return;
    const orgHeaders = ((upstream.get('opencode') || {}).headers) || {};
    editor.add({
      info: {
        id: VIRTUAL_PROVIDER,
        name: 'Modelselect',
        activation: 'enabled',
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL },
        headers: { ...orgHeaders },
      },
      models: [
        virtualModelEntry(VIRTUAL_FREE, 'Auto free-first (modelselect routes every turn)'),
        virtualModelEntry(VIRTUAL_GO, 'Auto go-first (modelselect routes every turn)'),
      ],
    });
    virtualRegistered = true;
  }

  let virtualRegistered = false;
  // Desired wire protocol per virtual model (see ENDPOINT_PACKAGES);
  // absent = provider default (chat). Applied by applyVirtualApi on every
  // catalog materialize. The catalog is process-global: concurrent virtual
  // sessions overwrite each other's wanted state — accepted (serialized
  // turns, the norm, are exact).
  const virtualApiWanted = new Map(); // virtual model id -> { endpoint, id }
  // Desired task-think default per virtual model (see THINK_VARIANTS):
  // reasoningEffort/reasoning_effort for a concrete level, absent for
  // `default`/null (no effort forced — upstream default applies). A manual
  // picker variant needs no wanted state here: the host merges the session
  // ref's variant overlay over these model-level values at dispatch time.
  const virtualThinkWanted = new Map(); // virtual model id -> effort level | null
  try {
    proxy = await startProxy({
      getUpstream: upstreamFor,
      getToken: () => {
        try {
          return resolveToken(rawOptions, process.env).token || '';
        } catch {
          return '';
        }
      },
      verbose: opts.verbose,
    });
  } catch (err) {
    console.error(`[modelselect] proxy failed to start: ${err?.message ?? err}`);
    proxy = null;
  }
  if (typeof ctx.provider?.transform === 'function') {
    try {
      const reg = await ctx.provider.transform(registerVirtual);
      if (reg) registrations.push(reg);
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual provider registration skipped: ${err?.message ?? err}`);
    }
  }

  // Per-turn protocol applier: patches each virtual model's `api` from
  // virtualApiWanted. Registered AFTER the registration cb (so it sees the
  // fresh entries the registration cb re-materializes) and re-run via
  // `reload()`/`transform()` whenever the wanted state changes.
  function applyVirtualApi(editor) {
    try {
      captureUpstream(editor);
      if (typeof editor.get !== 'function' || !editor.models || typeof editor.models.set !== 'function') return;
      const live = editor.get(VIRTUAL_PROVIDER);
      if (!live) return;
      const current =
        live.models instanceof Map
          ? [...live.models.values()]
          : Array.isArray(live.models)
            ? [...live.models]
            : [];
      let changed = false;
      const next = current.map((m) => {
        if (!m || !VIRTUAL_MODELS.includes(m.id)) return m;
        const wanted = virtualApiWanted.get(m.id) || null;
        const pkg = wanted && wanted.endpoint ? ENDPOINT_PACKAGES[wanted.endpoint] : undefined;
        const patched = { ...m };
        if (pkg) {
          // No url: inherits the provider base — the proxy. All three
          // protocols share the one localhost base; the proxy preserves
          // the driver's path when forwarding to the real base.
          const api = { id: wanted.id, type: 'aisdk', package: pkg };
          const same =
            patched.api &&
            patched.api.id === api.id &&
            patched.api.type === api.type &&
            patched.api.package === api.package;
          if (!same) {
            patched.api = api;
            changed = true;
          }
        } else if (patched.api) {
          delete patched.api; // restore the provider default protocol
          changed = true;
        }
        // Task-think default: mirror the wanted effort onto the entry's
        // settings + body (concrete levels only; `default`/null clears a
        // stale hint). A manual picker variant still wins — the host merges
        // the variant overlay over these model-level values per dispatch.
        const think = normalizeThink(virtualThinkWanted.get(m.id));
        const wantEffort = think && think !== 'default' ? think : null;
        const settings = { ...(patched.settings || {}) };
        const body = { ...(patched.body || {}) };
        let settingsChanged = false;
        let bodyChanged = false;
        if (wantEffort) {
          if (settings.reasoningEffort !== wantEffort) {
            settings.reasoningEffort = wantEffort;
            settingsChanged = true;
          }
          if (body.reasoning_effort !== wantEffort) {
            body.reasoning_effort = wantEffort;
            bodyChanged = true;
          }
        } else {
          if (Object.hasOwn(settings, 'reasoningEffort')) {
            delete settings.reasoningEffort;
            settingsChanged = true;
          }
          if (Object.hasOwn(body, 'reasoning_effort')) {
            delete body.reasoning_effort;
            bodyChanged = true;
          }
        }
        if (settingsChanged) {
          if (Object.keys(settings).length > 0) patched.settings = settings;
          else delete patched.settings;
          changed = true;
        }
        if (bodyChanged) {
          if (Object.keys(body).length > 0) patched.body = body;
          else delete patched.body;
          changed = true;
        }
        return patched;
      });
      if (changed) editor.models.set(VIRTUAL_PROVIDER, next);
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual api apply skipped: ${err?.message ?? err}`);
    }
  }
  if (typeof ctx.provider?.transform === 'function') {
    try {
      const reg = await ctx.provider.transform(applyVirtualApi);
      if (reg) registrations.push(reg);
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual api registration skipped: ${err?.message ?? err}`);
    }
  }

  // Point a virtual model's catalog `api` at the pick's wire protocol
  // and re-materialize so the NEXT route resolution (URL + body + decoder)
  // matches. Must run in the context/aux hooks — the runner picks the
  // route when it resolves the model, so an http.request-time write would
  // be too late for the current attempt (the routing hook re-assert below
  // only covers retries / next attempts). Best-effort: without a usable
  // SDK hook the proxy still forwards on the driver's default route.
  async function syncVirtualApiFor(pick, virtualId) {
    try {
      if (!pick || !pick.id || !virtualId) return;
      let endpoint = typeof pick.endpoint === 'string' ? pick.endpoint : null;
      if (!endpoint) {
        // Picks stored without an endpoint — derive it from the config's
        // bare-id map.
        const { config } = await loadConfig(opts, cacheDir);
        const map = config && config.endpoints;
        const bare = String(pick.id).split('/').pop();
        endpoint = map && typeof map[bare] === 'string' ? map[bare] : null;
      }
      virtualApiWanted.set(virtualId, { endpoint, id: pick.id });
      virtualThinkWanted.set(virtualId, normalizeThink(pick.think));
      if (typeof ctx.provider?.reload === 'function') {
        await ctx.provider.reload();
        if (opts.verbose) {
          console.log(
            `[modelselect] virtual api sync via reload → ${pick.providerID}/${pick.id} (endpoint=${endpoint || 'default'})`,
          );
        }
      } else if (typeof ctx.provider?.transform === 'function') {
        // SDK without `reload`: transform re-materializes; the appended
        // duplicates are the same stable cb reading the same wanted state.
        await ctx.provider.transform(applyVirtualApi);
        if (opts.verbose) {
          console.log(
            `[modelselect] virtual api sync via transform → ${pick.providerID}/${pick.id} (endpoint=${endpoint || 'default'})`,
          );
        }
      }
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual api sync skipped: ${err?.message ?? err}`);
    }
  }
  // `/modelselect` chat command: no argument prints status (router-sync,
  // host + source, virtual pick, last pick); `sync on|off` writes the
  // router-sync switch.
  // Output prefers `ctx.session.synthetic` (renders without a model turn —
  // a status read must not cost tokens) and falls back to
  // `ctx.session.prompt` if the host rejects synthetic messages. Never
  // throws: failures only log.
  async function runModelselectCommand({ sessionID, prompt, delivery }) {
    const text = promptTextFromPrompt(prompt);
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] && tokens[0].toLowerCase() === ID) tokens.shift(); // tolerate the command word
    const arg = (tokens[0] ?? '').toLowerCase();
    const lines = [];
    if (arg === 'sync') {
      const next = (tokens[1] ?? '').toLowerCase();
      if (next === 'on' || next === 'off') {
        lines.push(
          writeRoutingSync(cacheDir, next === 'on')
            ? `[modelselect] router sync \u2192 ${next}`
            : '[modelselect] router sync change failed (want on or off)',
        );
      } else {
        lines.push(`[modelselect] sync wants on or off (got '${tokens[1] ?? ''}')`);
      }
    } else if (arg) {
      lines.push(`[modelselect] unknown argument '${tokens[0]}' — use sync on or sync off`);
    } else {
      lines.push(`[modelselect] routing-sync=${readRoutingSync(cacheDir) ? 'on' : 'off'}`);
      // Per-session host view: option/env still win, the session-map leg
      // checks THIS session (setup only knew "any fresh entry").
      const now = resolveHost({
        options: opts,
        env: process.env,
        hasSessionHit: () => sessionMapHit(cacheDir, sessionID),
      });
      lines.push(`[modelselect] host=${now.host} (source=${now.source})`);
      if (sessionID) {
        lines.push(
          virtualSessions.has(sessionID)
            ? `[modelselect] session pick=${VIRTUAL_PROVIDER}/${virtualIds.get(sessionID) || '*'} (re-routes every turn)`
            : '[modelselect] session pick=persisted (not virtual)',
        );
      }
      try {
        const fs = require('node:fs');
        const st = JSON.parse(fs.readFileSync(statusFile(cacheDir, sessionID), 'utf8'));
        const age = typeof st.updatedAt === 'number' ? Math.round((Date.now() - st.updatedAt) / 1000) : null;
        lines.push(
          `[modelselect] last task=${st.taskType ?? '?'} tier=${st.tier ?? '?'} model=${st.model ?? '?'}` +
            `${age === null ? '' : ` (${age}s ago)`}`,
        );
      } catch {
        lines.push('[modelselect] last: no status yet');
      }
    }
    const out = lines.join('\n');
    try {
      await ctx.session.synthetic({ sessionID, text: out });
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] synthetic output failed: ${err?.message ?? err}`);
      try {
        await ctx.session.prompt({ sessionID, text: out, delivery: delivery === 'queue' ? 'queue' : 'steer' });
      } catch (err2) {
        console.error(`[modelselect] command output failed: ${err2?.message ?? err2}`);
      }
    }
  }

  if (typeof ctx.command?.transform === 'function') {
    try {
      await ctx.command.transform((editor) => {
        editor.add({
          name: ID,
          description: 'Show modelselect status or toggle the router sync (sync on|off)',
          execute: async (input) => {
            try {
              await runModelselectCommand(input);
            } catch (err) {
              console.error(`[modelselect] command failed: ${err?.message ?? err}`);
            }
          },
        });
      });
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] command registration skipped: ${err?.message ?? err}`);
    }
  }

  // Resolve task-type with continuation: zero-signal turns (acks like
  // "do it" / "sì, procedi", answers after a question, any language)
  // inherit the previous substantive turn instead of falling to generic.
  // Returns { taskType, jev, continued } and refreshes history when the
  // turn carries its own signal. Jev sees previous prompt (+ assistant
  // snippet when available) as context on continued turns.
  async function resolveTask({ sessionID, text, files, agent, assistantSnippet }) {
    const prev = (sessionID && history.get(sessionID)) || null;
    const base = {
      prompt: text,
      files,
      repo,
      agent,
      fixedTaskType: opts.taskType,
      agentTaskMap: opts.agentTaskMap,
      defaultTaskType: opts.defaultTaskType,
    };
    const r = opts.continuation
      ? resolveWithHistory(base, prev)
      : (() => {
          const { inferTaskType } = require('./shared/detect');
          const first = inferTaskType(base);
          return { ...first, heuristic: first.taskType, continued: false, ack: false, signal: 1 };
        })();
    let taskType = r.taskType;
    let jev = r.override ? 'pinned' : 'off';
    if ((!opts.taskType || opts.taskType === 'auto') && !r.override) {
      const jevPrompt = r.continued
        ? continuationState({
            current: text,
            historyPrompt: prev?.prompt ?? '',
            assistantSnippet: assistantSnippet ?? '',
            historyChars: opts.historyChars,
          })
        : text;
      const refined = await refineTaskTypeWithJev({
        heuristic: taskType,
        prompt: jevPrompt,
        files,
        agent,
        opts,
        cacheDir,
      });
      // On continued turns a low-confidence / unknown Jev answer keeps the
      // inherited task (already the heuristic); a confident Jev override wins.
      taskType = refined.taskType;
      jev = jevLabel(refined);
      if (r.continued && refined.status !== 'ok') jev = `${jev}+cont`;
    }
    if (!r.override && !r.fastPath) {
      if (r.continued) {
        if (opts.verbose) console.log(`[modelselect] continued task=${taskType} (prev=${prev?.task}) ack=${r.ack}`);
      } else if (shouldRemember({ ...r, taskType })) {
        if (sessionID) history.set(sessionID, { task: taskType, prompt: truncate(text, opts.historyChars) });
      }
    } else if (r.override && sessionID) {
      history.set(sessionID, { task: taskType, prompt: truncate(text, opts.historyChars) });
    }
    return { taskType, jev, continued: r.continued };
  }

  // Append the terse pick line to the prompt text. v2 shape first
  // (`prompt.text`), then the legacy string / `{ parts }` / `{ content }`
  // forms; returns false when nothing could be edited (e.g. frozen).
  function appendPromptLine(event, line) {
    const p = event.prompt;
    if (p && typeof p === 'object' && typeof p.text === 'string') {
      try {
        p.text = `${p.text}\n${line}`;
        return true;
      } catch {
        return false;
      }
    }
    if (typeof p === 'string') {
      try {
        event.prompt = `${p}\n${line}`;
        return true;
      } catch {
        return false;
      }
    }
    if (p && typeof p === 'object') {
      try {
        if (Array.isArray(p.parts)) {
          p.parts.push({ type: 'text', text: line });
          return true;
        }
        if (typeof p.content === 'string') {
          p.content = `${p.content}\n${line}`;
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  // Chat-visible pick line. v2 has no zero-token visible channel:
  // context-hook edits never render, so the terse line is appended here in
  // the prompt hook (it persists+renders, ~15 tokens/turn). The second
  // resolve in the context hook is ~free (24h config cache + 5min quota
  // cache). `switch` (default) emits only when the pick differs from the
  // previously applied pick (applied) and the last announced pick (covers
  // suggestOnly, where applied never moves); first turn counts as a switch.
  // Never throws — failures only log.
  async function maybeAnnounce(event, text, { files = [], agent = undefined } = {}) {
    // Returns the resolved pick (`{ picked, virtualId }`) when the turn
    // resolved one — even when deduped to silence — so the prompt-hook
    // pre-sync can reuse it instead of resolving (and Jev-refining) twice.
    // Null/undefined when nothing resolved (announce off, empty text, failure).
    if (opts.announce === 'off' || !text.trim() || !event.sessionID) return null;
    try {
      const { taskType, jev } = await resolveTask({ sessionID: event.sessionID, text, files, agent });
      // A virtual session announces its pinned preference (first turn can
      // still miss this: the prompt hook runs before the context hook
      // records the virtual id).
      const virtualId = virtualIds.get(event.sessionID);
      const effectiveOpts = virtualId ? { ...opts, autoPreference: preferenceForVirtualId(virtualId) } : opts;
      const picked = await resolveModel({ taskType, opts: effectiveOpts, cacheDir });
      const key = picked.model;
      const resolved = { picked, virtualId };
      if (!shouldAnnounce(opts.announce, key, applied.get(event.sessionID), announced.get(event.sessionID))) return resolved;
      const line = formatAnnounce({
        taskType: picked.taskType,
        tier: picked.tier,
        model: picked.model,
        suggestOnly: opts.suggestOnly,
        jev,
      });
      if (!appendPromptLine(event, line)) {
        console.error(`[modelselect] announce skipped: could not edit prompt for session ${event.sessionID}`);
        return resolved;
      }
      announced.set(event.sessionID, key);
      return resolved;
    } catch (err) {
      console.error(`[modelselect] announce skipped: ${err?.message ?? err}`);
      return null;
    }
  }

  // Keep OpenChamber's Jev routing categories (`~/.config/openchamber/
  // routing.json`) in sync with the plugin caches before every turn —
  // best-effort, never breaks the turn, and skipped entirely while the
  // router-sync switch is off (`<cacheDir>/routing-sync.json`, default
  // on). Optional: on a machine without OpenChamber the write fails
  // silently and nothing is ever created. The sync is a courtesy for
  // OpenChamber users; the plugin's own routing never reads routing.json.
  async function syncRoutingNow() {
    if (!readRoutingSync(cacheDir)) return;
    try {
      const r = await syncRouting(routingIo);
      if (r.written && opts.verbose) console.log('[modelselect] routing.json synced');
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] routing sync skipped: ${err?.message ?? err}`);
    }
  }

  // Last known task for a session: the per-turn status file first (a
  // virtual session rewrites it every turn), then the continuation
  // history. Returns
  // `{ taskType, prev }` where `prev` is the parsed status (or null).
  function sessionTask(sessionID) {
    try {
      const fs = require('node:fs');
      const st = JSON.parse(fs.readFileSync(statusFile(cacheDir, sessionID), 'utf8'));
      const t = st && typeof st.taskType === 'string' ? st.taskType : '';
      if (t) return { taskType: t, prev: st };
    } catch {
      // missing/unusable status -> fall back to history
    }
    const h = sessionID && history.get(sessionID);
    return h && h.task ? { taskType: h.task, prev: null } : null;
  }

  // Register a free-side exhaustion: latch the observation PER MODEL
  // (quota uses a 12h window, rate limiting uses a 1h window — read by
  // routing sync + resolveModel), refresh routing.json right away (while
  // the router sync is on), and on the first failure per VIRTUAL session
  // while `suggestOnly` is off arm the one forced retry — the retried
  // dispatch flows through the proxy again and re-resolves with the fresh
  // latch preferring go. Non-virtual sessions are the user's
  // manual choice: latch + sync only, never armed. Zen publishes no
  // free-quota endpoint (anomalyco/opencode#18648), so the failed real
  // request IS the check.
  async function noteFreeExhaustion(sessionID, ref, detail, kind = 'exhaustion') {
    const rid = ref && (ref.id ?? ref.modelID);
    markFreeQuota(cacheDir, {
      kind,
      model: ref && rid ? `${ref.providerID}/${rid}` : null,
      detail,
    });
    await syncRoutingNow();
    if (!sessionID || freeFlipped.has(sessionID)) return;
    if (!virtualSessions.has(sessionID) || opts.suggestOnly) return;
    freeFlipped.add(sessionID);
    const cause = kind === 'rate-limit' ? 'rate-limited' : 'exhausted';
    // Never switchModel here: the session must keep re-routing every turn.
    // Arm the one forced retry; the retried dispatch re-resolves through
    // the routing headers, where the fresh latch prefers go.
    freeRetry.set(sessionID, Date.now());
    console.log(`[modelselect] free tier ${cause} (${detail}) — virtual session stays virtual, retry armed`);
  }

  console.log(
    `[modelselect] loaded (tier=${opts.tier} host=${host.host}/${host.source} virtual=${virtualRegistered ? 'on' : 'off'} proxy=${proxy ? `127.0.0.1:${proxy.port}` : 'off'} token-source=${opts.tokenSource || 'none'} announce=${opts.announce} verbose=${opts.verbose} suggestOnly=${opts.suggestOnly})`,
  );

  await ctx.session.hook('prompt', async (event) => {
    try {
      // Sync OpenChamber routing before every question (router-sync
      // toggle applies inside syncRoutingNow), then gate on the virtual
      // pick: only virtual `auto` sessions announce — any other model is
      // the user's hands-off choice. First turn on a virtual pick can
      // miss this (the prompt hook runs before the context hook marks
      // the session); the announce then lands on the next turn instead.
      await syncRoutingNow();
      if (!virtualSessions.has(event.sessionID)) return;
      // v2 event: { sessionID, messageID, prompt: { text, files?, agents? },
      // delivery }. `event.agent` does not exist here — the agent tag comes
      // from prompt mentions (best-effort; undefined when absent).
      const text = promptTextFromPrompt(event.prompt);
      const files = filesFromPrompt(event.prompt);
      const agent = agentFromPrompt(event.prompt) ?? event.agent;
      if (text.trim() && event.sessionID) prompts.set(event.sessionID, text);
      const resolved = await maybeAnnounce(event, text, { files, agent });
      // Pre-sync the virtual entry's wire protocol ahead of the context
      // hook: the runner may pin the dispatch route before the per-turn
      // re-point lands, so a synced api here gives the context reload a
      // head start (turn 2+; turn 1 runs before the session is marked
      // virtual). Reuses the announce resolution when there is one so a
      // turn pays at most one Jev refinement. Trial mode changes nothing.
      if (!opts.suggestOnly && text.trim() && event.sessionID) {
        try {
          let pick = null;
          let virtualId = virtualIds.get(event.sessionID);
          if (resolved && resolved.picked) {
            const ref = splitModelRef(resolved.picked.model);
            pick = { providerID: ref.providerID, id: ref.id, endpoint: resolved.picked.endpoint ?? null, think: resolved.picked.think ?? null };
            virtualId = resolved.virtualId ?? virtualId;
          } else if (opts.announce === 'off') {
            const { taskType } = await resolveTask({ sessionID: event.sessionID, text, files, agent });
            const picked = await resolveModel({
              taskType,
              opts: { ...opts, autoPreference: preferenceForVirtualId(virtualId) },
              cacheDir,
            });
            const ref = splitModelRef(picked.model);
            pick = { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null };
          }
          if (pick && virtualId) await syncVirtualApiFor(pick, virtualId);
        } catch {
          // best-effort: the context hook syncs again before dispatch
        }
      }
    } catch {
      // never break the session
    }
  });

  await ctx.session.hook('context', async (event) => {
    try {
      const sessionID = event.sessionID;
      // Track the virtual pick BEFORE the routing gate: a virtual model
      // IS the switch (the picker selects routing per session), and the
      // free-exhaustion paths consult virtualSessions because their
      // http/retry events carry the virtual ref while the real pick lives
      // in lastVirtualPick.
      const virtual = isVirtualRef(event.model);
      const virtualId = virtual ? event.model.id : null;
      if (sessionID) {
        if (virtual) {
          virtualSessions.add(sessionID);
          virtualIds.set(sessionID, virtualId);
        } else {
          virtualSessions.delete(sessionID);
          virtualIds.delete(sessionID);
        }
      }
      // Sync OpenChamber routing first (fresh categories for this turn,
      // router-sync toggle inside syncRoutingNow), then gate on the
      // virtual pick — any other model is the user's hands-off choice.
      await syncRoutingNow();
      // A retried turn that succeeded leaves its protocol arm behind;
      // without expiry that stale arm would swallow the next independent
      // mismatch, so arms older than the retry window are forgotten here
      // (the retry hook applies the same TTL when consuming).
      if (sessionID && protocolRetry.has(sessionID)) {
        try {
          if (Date.now() - protocolRetry.get(sessionID) > PROTOCOL_RETRY_TTL_MS) {
            protocolRetry.delete(sessionID);
          }
        } catch {
          // never break the turn
        }
      }
      if (!virtual) {
        if (opts.verbose) console.log(`[modelselect] not ${VIRTUAL_PROVIDER}/*: routing skipped for session=${sessionID}`);
        return;
      }
      // Virtual sessions only: the plugin owns the pick here. The virtual
      // model pins the preference — the global autoPreference is only the
      // fallback for non-virtual resolutions (announce, status reads).
      const prompt = prompts.get(sessionID) ?? promptTextFromMessages(event.messages);
      const assistantSnippet = lastAssistantSnippet(event.messages, 1000);
      const { taskType, jev } = await resolveTask({
        sessionID,
        text: prompt,
        files: [],
        agent: event.agent,
        assistantSnippet,
      });
      const effectiveOpts = { ...opts, autoPreference: preferenceForVirtualId(virtualId) };
      const picked = await resolveModel({ taskType, opts: effectiveOpts, cacheDir });
      const ref = splitModelRef(picked.model);
      const key = `${ref.providerID}/${ref.id}`;
      writeStatus(cacheDir, sessionID ?? 'default', {
        taskType: picked.taskType,
        tier: picked.tier,
        model: picked.model,
        jev,
        goOk: picked.goOk ?? null,
        think: picked.think ?? null,
        variant: normalizeThink(event.model && event.model.variant),
        freeExhausted: picked.freeExhausted ?? null,
        source: picked.source,
        suggestOnly: opts.suggestOnly,
      });
      if (opts.suggestOnly) {
        // Trial mode: resolve everything but change nothing.
        const current =
          event.model && typeof event.model === 'object'
            ? `${event.model.providerID}/${event.model.id}`
            : '?';
        console.log(
          `[modelselect] (suggest-only) task=${picked.taskType} tier=${picked.tier} would-select=${key} current=${current} jev=${jev}`,
        );
        // Still record the pick: aux requests (title/…) on a virtual
        // session need a dispatchable ref even in trial mode.
        if (virtual && sessionID) lastVirtualPick.set(sessionID, { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null });
        return;
      }
      // The session stays on its virtual anchor for its whole life:
      // event.model is never mutated to the real pick (that would dispatch
      // past the proxy on the wrong driver) and nothing is ever persisted.
      // The `http.request` hook stamps the pick into routing headers +
      // body, and the proxy forwards it to the real base.
      if (virtual && sessionID) lastVirtualPick.set(sessionID, { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null });
      // Point THIS virtual model's catalog `api` at the pick's protocol
      // before the runner resolves the model (per-model wanted state —
      // the two virtual models route independently).
      await syncVirtualApiFor({ providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null }, virtualId);
      // A resolved free pick with no fresh latch closes the previous
      // free episode so a later exhaustion can arm a new retry.
      if (virtual && sessionID) {
        try {
          if (!isFreeQuotaFresh(cacheDir, Date.now(), key)) freeFlipped.delete(sessionID);
        } catch {
          // never break the turn
        }
      }
      if (opts.verbose) {
        console.log(
          `[modelselect] task=${picked.taskType} tier=${picked.tier} model=${key} jev=${jev} (virtual ${VIRTUAL_PROVIDER}/${virtualId})`,
        );
      }
    } catch (err) {
      console.error(`[modelselect] keeping current model: ${err?.message ?? err}`);
    }
  });

  // Auxiliary requests (title/compaction/generate) bypass the `context`
  // hook. They keep the session's virtual anchor untouched — mutating
  // `event.model` to the real pick would dispatch past the proxy — and
  // the `http.request` hook below stamps the routing headers from the
  // pick recorded here. The on-the-spot resolve primes `lastVirtualPick`
  // for title-first sessions. Non-virtual sessions keep their own models
  // here, as before.
  for (const aux of ['title', 'compaction', 'generate']) {
    await ctx.session.hook(aux, async (event) => {
      try {
        const sessionID = event.sessionID;
        if (!sessionID || !isVirtualRef(event.model)) return;
        const virtualId = event.model.id;
        virtualIds.set(sessionID, virtualId);
        let pick = lastVirtualPick.get(sessionID);
        if (!pick) {
          const { taskType } = await resolveTask({
            sessionID,
            text: prompts.get(sessionID) ?? '',
            files: [],
            agent: undefined,
            assistantSnippet: '',
          });
          const picked = await resolveModel({
            taskType,
            opts: { ...opts, autoPreference: preferenceForVirtualId(virtualId) },
            cacheDir,
          });
          const ref = splitModelRef(picked.model);
          pick = { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null };
          lastVirtualPick.set(sessionID, pick);
        }
        // Aux requests dispatch through the same route machinery — apply
        // the pick's protocol before the runner resolves the model.
        await syncVirtualApiFor(pick, virtualId);
      } catch {
        // never break the session
      }
    });
  }

  // Virtual routing headers: the session always dispatches on its virtual
  // anchor (the proxy owns that endpoint), so every physical attempt gets
  // the live pick stamped into `x-modelselect-*` headers + body, where the
  // proxy forwards it to the real base. Resolves on the spot when no pick
  // exists yet and re-resolves when the stored pick just hit a fresh
  // exhaustion latch, so every physical attempt (including armed retries,
  // which do not re-run the context hook) carries a live decision. All
  // picks flow through the same proxy whatever their provider — sessions
  // never leave virtual mode. Non-virtual sessions are untouched.
  async function routeVirtualRequest(event) {
    try {
      const sessionID = event.sessionID;
      if (!sessionID) return;
      const sessionModel = event.model && typeof event.model === 'object' ? event.model : null;
      if (!virtualSessions.has(sessionID) && !isVirtualRef(sessionModel)) return;
      const virtualId = isVirtualRef(sessionModel) ? sessionModel.id : virtualIds.get(sessionID) || null;
      if (virtualId) virtualIds.set(sessionID, virtualId);
      const preference = virtualId ? preferenceForVirtualId(virtualId) : opts.autoPreference;
      let pick = lastVirtualPick.get(sessionID);
      if (
        !pick ||
        (isFreeModelRef(pick, readModelTable(cacheDir)) &&
          isFreeQuotaFresh(cacheDir, Date.now(), `${pick.providerID}/${pick.id}`))
      ) {
        const where = sessionTask(sessionID);
        const { taskType } = where
          ? { taskType: where.taskType }
          : await resolveTask({
              sessionID,
              text: prompts.get(sessionID) ?? '',
              files: [],
              agent: undefined,
              assistantSnippet: '',
            });
        const picked = await resolveModel({ taskType, opts: { ...opts, autoPreference: preference }, cacheDir });
        const ref = splitModelRef(picked.model);
        pick = { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null };
        lastVirtualPick.set(sessionID, pick);
      }
      // Re-assert this virtual model's protocol (covers armed retries,
      // which do not re-run the context hook, and picks stored without
      // an endpoint).
      if (virtualId) await syncVirtualApiFor(pick, virtualId);
      // Headers first: the proxy refuses to forward blind, so routing
      // metadata must land even when the body can't be rewritten.
      try {
        event.request.headers.set(HEADER_PROVIDER, pick.providerID);
        event.request.headers.set(HEADER_MODEL, pick.id);
        if (pick.endpoint) event.request.headers.set(HEADER_ENDPOINT, pick.endpoint);
        else event.request.headers.delete(HEADER_ENDPOINT);
      } catch {
        return;
      }
      const req = event.request;
      if (!req || typeof req.clone !== 'function') return;
      let text;
      try {
        text = await req.clone().text();
      } catch {
        return;
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return;
      }
      if (!body || typeof body !== 'object' || !VIRTUAL_MODELS.includes(body.model)) return;
      body.model = pick.id;
      try {
        const next = new Request(req, { body: JSON.stringify(body) });
        // new Request copies headers, but re-stamp: the headers ARE the route.
        next.headers.set(HEADER_PROVIDER, pick.providerID);
        next.headers.set(HEADER_MODEL, pick.id);
        if (pick.endpoint) next.headers.set(HEADER_ENDPOINT, pick.endpoint);
        event.request = next;
      } catch {
        return;
      }
      if (opts.verbose) {
        console.log(`[modelselect] virtual route → ${pick.providerID}/${pick.id} (kind=${event.kind || '-'})`);
      }
    } catch {
      // never break the session
    }
  }
  await ctx.session.hook('http.request', routeVirtualRequest);

  // Fail-soft: classify real free-side failures (Zen has no quota
  // endpoint to probe — the failed request IS the check; quota uses a 12h
  // latch, transient rate limiting uses a 1h latch in shared/freequota.js).
  // Only agent-loop (`primary`) traffic flips: title/compaction/generate
  // calls on non-virtual sessions keep their own models.
  await ctx.session.hook('http.response', async (event) => {
    try {
      if (event.kind && event.kind !== 'primary') return;
      const res = event.response;
      if (!res || typeof res.status !== 'number' || res.status < 400) return;
      let outcome = classifyFreeFailure(res.status, '');
      if (!outcome.exhausted) {
        // Bodies are one-shot streams: clone before reading, never the
        // original response. Only non-obvious statuses need the body.
        let text = '';
        try {
          text = await res.clone().text();
        } catch {
          // unreadable body -> status-only classification below
        }
        outcome = classifyFreeFailure(res.status, text);
        if (!outcome.exhausted) return;
      }
      // event.model is the virtual anchor in real flow — classify the real
      // pick, so a virtual session latches its failing model instead of
      // nothing. A real (non-virtual) event model names the failing side
      // directly and wins (go-side failures must not latch free).
      const ref = refForFailure(event.sessionID, event.model, virtualSessions, lastVirtualPick);
      if (!isFreeModelRef(ref, readModelTable(cacheDir))) return;
      await noteFreeExhaustion(
        event.sessionID,
        ref,
        `http ${res.status}`,
        outcome.rateLimited ? 'rate-limit' : 'exhaustion',
      );
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] free-exhaustion check skipped: ${err?.message ?? err}`);
    }
  });

  // Exactly one forced retry per flip so the session resumes on the go
  // model; the arm is consumed once (60s TTL) and OpenCode's built-in
  // attempt cap bounds anything else — this can never loop. The retried
  // dispatch flows through the proxy again and re-resolves with the fresh
  // latch preferring go — the session model itself never moves. Also the
  // fallback when a failure arrives without a response we classified.
  await ctx.session.hook('retry', async (event) => {
    try {
      const armedAt = freeRetry.get(event.sessionID);
      if (armedAt !== undefined) {
        freeRetry.delete(event.sessionID);
        if (Date.now() - armedAt <= FREE_RETRY_TTL_MS) {
          event.decision = { retry: true, delay: 0 };
          if (opts.verbose) console.log(`[modelselect] retrying on go after free exhaustion session=${event.sessionID}`);
        }
        return;
      }
      const err = event.error;
      // Wire-protocol mismatch on a virtual session: the virtual entry's
      // catalog `api` missed the pick's protocol (stale endpoints map,
      // first-turn race, or a host that pins the session route before the
      // per-turn re-point), so the driver dispatched on the wrong route
      // and Zen answered ModelProtocolUnsupported. Re-sync the `api` to
      // the pick's protocol AND move the session onto the real pick: the
      // virtual chat-default driver cannot speak a responses/messages
      // pick, while the real provider dispatches its own models natively
      // (a direct opencode/muse-spark-1.3-contributor-free turn succeeds
      // where the virtual dispatch 400s). The retried attempt then
      // resolves its route against the real provider. This leaves virtual
      // mode for the session (later turns are hands-off), but a working
      // real-model session beats a stuck virtual one. Never latched: a
      // routing miss is not quota exhaustion. One shot per window (see
      // PROTOCOL_RETRY_TTL_MS): a stale arm from a long-ago success
      // expires so the next independent mismatch retries again. The
      // re-sync persists for later turns via virtualApiWanted.
      if (isProtocolMismatch(err)) {
        const sessionID = event.sessionID;
        const isVirtual = Boolean(
          sessionID && (virtualSessions.has(sessionID) || isVirtualRef(event.model)),
        );
        if (!isVirtual || opts.suggestOnly) return;
        const armedAt = protocolRetry.get(sessionID);
        if (armedAt !== undefined) {
          protocolRetry.delete(sessionID);
          // One shot per window: a fresh arm means the retried attempt
          // already had its chance — never loop. A stale arm (a retried
          // turn that succeeded long ago) is forgotten so the next
          // independent mismatch retries again instead of being swallowed.
          if (Date.now() - armedAt <= PROTOCOL_RETRY_TTL_MS) return;
        }
        try {
          const virtualId = virtualIds.get(sessionID) || (isVirtualRef(event.model) ? event.model.id : null);
          const preference = virtualId ? preferenceForVirtualId(virtualId) : opts.autoPreference;
          const where = sessionTask(sessionID);
          const taskType = where
            ? where.taskType
            : (
                await resolveTask({
                  sessionID,
                  text: prompts.get(sessionID) ?? '',
                  files: [],
                  agent: undefined,
                  assistantSnippet: '',
                })
              ).taskType;
          const picked = await resolveModel({ taskType, opts: { ...opts, autoPreference: preference }, cacheDir });
          const ref = splitModelRef(picked.model);
          const pick = { providerID: ref.providerID, id: ref.id, endpoint: picked.endpoint ?? null, think: picked.think ?? null };
          lastVirtualPick.set(sessionID, pick);
          if (virtualId) await syncVirtualApiFor(pick, virtualId);
          // Fail soft off virtual mode: a re-synced catalog alone cannot
          // save the retry while the session stays pinned to the virtual
          // chat route — persist the real pick (best-effort; a host
          // without switchModel keeps the plain re-synced retry below).
          let landed = false;
          try {
            await ctx.session.switchModel({
              sessionID,
              model: { providerID: pick.providerID, id: pick.id },
            });
            landed = true;
          } catch (switchErr) {
            if (opts.verbose) console.log(`[modelselect] protocol fail-soft switch skipped: ${switchErr?.message ?? switchErr}`);
          }
          if (landed) {
            // The session now dispatches natively: stop stamping virtual
            // routing headers onto its attempts (the retried dispatch must
            // be a pure real-provider turn).
            virtualSessions.delete(sessionID);
            const prev = (where && where.prev) || {};
            writeStatus(cacheDir, sessionID ?? 'default', {
              taskType,
              tier: picked.tier,
              model: picked.model,
              jev: typeof prev.jev === 'string' ? prev.jev : null,
              goOk: typeof prev.goOk === 'boolean' ? prev.goOk : (picked.goOk ?? null),
              think: prev.think ?? picked.think ?? null,
              variant: null,
              freeExhausted: prev.freeExhausted ?? picked.freeExhausted ?? null,
              source: `${picked.source}+protocol-failsoft`,
              suggestOnly: opts.suggestOnly,
            });
          }
        } catch {
          // re-sync is best-effort; the retry below still gets its chance
        }
        protocolRetry.set(sessionID, Date.now());
        event.decision = { retry: true, delay: 0 };
        if (opts.verbose) console.log(`[modelselect] protocol mismatch re-synced, retrying session=${sessionID}`);
        return;
      }
      // Retry-hook errors arrive nested (e.g. `{ type: 'error',
      // error: { type: 'FreeUsageLimitError', message } }`), so read the
      // status through the wrapper keys and classify the flattened
      // haystack — top-level `err?.message` alone misses both the nested
      // rate-limit text and `Model ... has been deprecated` wording.
      const errStatus =
        err?.status ?? err?.error?.status ?? err?.cause?.status ?? err?.response?.status ?? null;
      const outcome = classifyFreeFailure(errStatus, mismatchHaystack(err, ''));
      if (!outcome.exhausted) return;
      const ref = refForFailure(event.sessionID, event.model, virtualSessions, lastVirtualPick);
      if (!isFreeModelRef(ref, readModelTable(cacheDir))) return;
      await noteFreeExhaustion(
        event.sessionID,
        ref,
        `retry ${err?.type ?? 'error'}`,
        outcome.rateLimited ? 'rate-limit' : 'exhaustion',
      );
      const now = freeRetry.get(event.sessionID);
      if (now !== undefined && Date.now() - now <= FREE_RETRY_TTL_MS) {
        freeRetry.delete(event.sessionID);
        event.decision = { retry: true, delay: 0 };
      }
    } catch {
      // never break the session
    }
  });

  // Unload cleanup: drop our catalog registrations and stop the proxy.
  return async () => {
    for (const reg of registrations) {
      try {
        await reg.dispose?.();
      } catch {
        // ignore
      }
    }
    if (proxy) {
      try {
        await proxy.close();
      } catch {
        // ignore
      }
      proxy = null;
    }
  };
}

module.exports = {
  id: ID,
  setup,
  virtualLimitFor,
  FALLBACK_VIRTUAL_LIMIT,
  FREE_RETRY_TTL_MS,
  PROTOCOL_RETRY_TTL_MS,
  VIRTUAL_PROVIDER,
  VIRTUAL_FREE,
  VIRTUAL_GO,
  VIRTUAL_MODELS,
  VIRTUAL_REF,
  isVirtualRef,
  preferenceForVirtualId,
  HEADER_PROVIDER,
  HEADER_MODEL,
  HEADER_ENDPOINT,
};
module.exports.default = module.exports;

