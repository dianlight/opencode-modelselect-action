'use strict';

/**
 * v2 entrypoint (loaded from package root `/index.js`; v2 ignores `main`).
 * Plain `{ id, setup }` object — `Plugin.define()` is only a type helper,
 * so zero dependencies are needed.
 *
 * Model routing verified against @opencode/plugin 2.0.x + @opencode/schema:
 * - `SessionRequest.model` is `Model.Ref = { id, providerID, variant? }`
 *   (note: `id`, not `modelID`). The property is compile-time readonly,
 *   so we mutate `providerID`/`id` fields IN PLACE on the context event —
 *   never reassign `event.model`.
 * - In-place mutation covers the in-flight turn; `ctx.session.switchModel`
 *   (`{ sessionID, model: Model.Ref }`) persists the choice for future
 *   turns like the TUI picker does. Both are best-effort: failures only
 *   log and keep the current model.
 * - Only the `context` (agent loop) hook is routed. `title`/`compaction`/
 *   `generate` requests intentionally keep their own models so cheap
 *   auxiliary calls stay cheap.
 * - The chat-visible announce line (`announce` option, default `switch`)
 *   is appended to `event.prompt.text` in the `prompt` hook (v2
 *   `PromptInput.Prompt = { text, files?, agents?, skills? }`): v2 has no
 *   zero-token visible channel (`context` edits never render), so the
 *   terse line persists+renders (~15 tokens/turn). The prompt hook event
 *   carries no `agent` field — the agent tag is read from prompt mentions.
 * - Global mode (`<cacheDir>/mode.json`): both hooks first sync
 *   OpenChamber's `routing.json` (shared `./shared/routing.js`), then
 *   `on` routes/announces every turn (default), `off` skips everything,
 *   and `auto` does only that sync and then acts like off — OpenChamber's
 *   Jev routing owns the pick.
 * - Free-tier fail-soft (`http.response` + `retry` hooks): Zen publishes
 *   no free-quota endpoint (anomalyco/opencode#18648), so exhaustion is
 *   detected from the real failed request — no dummy probe. A free-side
 *   `primary` response matching the fingerprints in `./shared/
 *   freequota.js` registers a latch (`.opencode/.modelselect-cache/
 *   free-quota.json`): spent quota uses 12h, transient rate limiting uses
 *   1h. Routing sync + `resolveModel` then prefer `go`, and the failing
 *   session flips to its task's go model with exactly one forced retry so
 *   the turn resumes on the paid alternative. The latch expires after its
 *   first-detection window (never extended), allowing a new check; mode
 *   `off`/`auto` and `suggestOnly` still latch + resync routing but never
 *   switch the session.
 * - Host detection (`./shared/host.js`): explicit `openchamber` option →
 *   `MODELSELECT_OPENCHAMBER` env → extension-written session map →
 *   standalone. Drives virtual-model registration and the `/modelselect`
 *   status line only; per-turn routing keys off `event.model` directly.
 * - Virtual model `opencode/auto` (standalone host only): an `auto`
 *   entry appended to the real `opencode` provider's inventory — a pick
 *   that routes exactly like mode `on` but never persists. The session
 *   stays on `opencode/auto` (the model picker IS the switch;
 *   `mode.json` is bypassed) while the `http.request` overlay writes the
 *   resolved pick into the outgoing body per physical attempt — mutating
 *   `event.model` is cosmetic (dispatch reads the persisted session
 *   model; proven live), so the overlay is what actually routes.
 *   Free-exhaustion on a virtual session arms the forced retry without
 *   `switchSessionToGo` (persisting go would unstick the virtual pick);
 *   the armed retry re-resolves through the same overlay, where the
 *   fresh latch prefers go. Cross-provider picks cannot be overlaid (the
 *   endpoint stays pinned to the session model) and persist instead —
 *   the session then leaves virtual mode and routes normally.
 * - `/modelselect` chat command (`ctx.command.transform`): no argument
 *   prints mode + host + last pick; `on|off|auto` writes the mode via
 *   `shared/status.js writeMode`. Output prefers `ctx.session.synthetic`
 *   (no model turn) with `ctx.session.prompt` as fallback.
 *
 * v2-only: the v1 `server()` entry was removed — this package now requires
 * OpenCode v2.
 */

const path = require('node:path');
const { detectRepoSignals } = require('./shared/detect');
const { refineTaskTypeWithJev, jevLabel } = require('./shared/jev');
const {
  resolveWithHistory,
  shouldRemember,
  continuationState,
  lastAssistantSnippet,
  truncate,
} = require('./shared/continuation');
const { normalizeOptions, resolveModel, splitModelRef, formatAnnounce, shouldAnnounce, loadConfig } = require('./shared/select');
const { readMode, writeMode, writeStatus, statusFile } = require('./shared/status');
const { resolveHost, sessionMapHit, sessionMapAnyHit, SESSION_MAP_FILE, SESSION_MAP_TTL_MS } = require('./shared/host');
const { syncRouting } = require('./shared/routing');
const { createRoutingIo } = require('./shared/routing-io');
const {
  classifyFreeFailure,
  isFreeModelRef,
  isFreeQuotaFresh,
  markFreeQuota,
  readModelTable,
} = require('./shared/freequota');

const ID = 'modelselect';
// Virtual model: `opencode/auto` — an `auto` entry appended to the REAL
// `opencode` provider's inventory, standalone-only. Selecting it routes
// like mode `on` but never persists (see header).
const VIRTUAL_PROVIDER = 'opencode';
const VIRTUAL_MODEL = 'auto';
const VIRTUAL_REF = `${VIRTUAL_PROVIDER}/${VIRTUAL_MODEL}`;
// Forced-retry arm window: a retry follows its failure within seconds, so
// an arm older than this (consumed late) is stale and must not fire.
const FREE_RETRY_TTL_MS = 60 * 1000;

/** Is this Model.Ref the virtual `opencode/auto` pick? */
function isVirtualRef(ref) {
  return Boolean(
    ref && typeof ref === 'object' && ref.providerID === VIRTUAL_PROVIDER && ref.id === VIRTUAL_MODEL,
  );
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
  const prompts = new Map(); // sessionID -> last prompt text
  const applied = new Map(); // sessionID -> "provider/id" already persisted
  const announced = new Map(); // sessionID -> last announced "provider/id" key
  const history = new Map(); // sessionID -> { task, prompt } last substantive turn
  const freeFlipped = new Set(); // sessions already flipped to go (process lifetime)
  const freeRetry = new Map(); // sessionID -> armedAt (epoch ms): one forced retry
  const virtualSessions = new Set(); // sessions whose current model is opencode/auto
  const lastVirtualPick = new Map(); // sessionID -> { providerID, id }: last resolved pick, for aux requests

  // Virtual model `opencode/auto`: an `auto` entry appended to the REAL
  // `opencode` provider's inventory, standalone-only (under OpenChamber
  // the host owns the model and a virtual entry would only clutter its
  // picker). A standalone fake provider cannot work: the dispatch driver
  // stays pinned to the session model (verified live — mutating
  // `event.model` renames the model but does not move the endpoint), so a
  // session on a fake provider can never reach a real endpoint, while a
  // fake model id on a real driver dies at load-time validation
  // (`UnsupportedPackageError` for `package: ""`, `Model is unavailable`
  // for a cloned real driver). Sitting on the real driver, the virtual
  // pick dispatches exactly like a turn-1 non-virtual route (proven live)
  // and the context hook re-routes it every turn since `switchModel` is
  // never called for it. The model literal mirrors @opencode/schema's
  // `Model.Info.default(providerID, id)` — copied here because the
  // package is zero-dependency. If a real `opencode/auto` model ever
  // ships, selecting it simply gets always-route behavior.
  // Existing inventory is preserved (and an existing `auto` entry is
  // never duplicated — the transform replays, and double registration
  // must stay idempotent). No `opencode` provider (or no models editor)
  // means no virtual model: failures only log, the rest of the plugin
  // works without it.
  let virtualRegistered = false;
  if (host.host === 'standalone' && typeof ctx.provider?.transform === 'function') {
    try {
      await ctx.provider.transform((editor) => {
        if (typeof editor.get !== 'function' || !editor.models || typeof editor.models.set !== 'function') return;
        const live = editor.get(VIRTUAL_PROVIDER);
        if (!live) return;
        const current = live.models instanceof Map ? [...live.models.values()] : [];
        const rest = current.filter((m) => !m || m.id !== VIRTUAL_MODEL);
        editor.models.set(VIRTUAL_PROVIDER, [
          ...rest,
          {
            id: VIRTUAL_MODEL,
            modelID: VIRTUAL_MODEL,
            providerID: VIRTUAL_PROVIDER,
            name: 'Auto (modelselect routes every turn)',
            capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
            variants: [],
            time: { released: 0 },
            cost: [],
            status: 'active',
            enabled: true,
            limit: { context: 200000, output: 32000 },
          },
        ]);
      });
      virtualRegistered = true;
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual model registration skipped: ${err?.message ?? err}`);
    }
  }

  // `/modelselect` chat command: no argument prints status (mode, host +
  // source, virtual pick, last pick); `on|off|auto` writes the mode.
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
    if (arg === 'on' || arg === 'off' || arg === 'auto') {
      lines.push(
        writeMode(cacheDir, arg) ? `[modelselect] mode \u2192 ${arg}` : '[modelselect] mode change failed (want on, off or auto)',
      );
    } else if (arg) {
      lines.push(`[modelselect] unknown argument '${tokens[0]}' — use on, off or auto`);
    } else {
      lines.push(`[modelselect] mode=${readMode(cacheDir)}`);
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
            ? `[modelselect] session pick=${VIRTUAL_REF} (re-routes every turn)`
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
          description: 'Show modelselect status or set the routing mode (on|off|auto)',
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
    if (opts.announce === 'off' || !text.trim() || !event.sessionID) return;
    try {
      const { taskType, jev } = await resolveTask({ sessionID: event.sessionID, text, files, agent });
      const picked = await resolveModel({ taskType, opts, cacheDir });
      const key = picked.model;
      if (!shouldAnnounce(opts.announce, key, applied.get(event.sessionID), announced.get(event.sessionID))) return;
      const line = formatAnnounce({
        taskType: picked.taskType,
        tier: picked.tier,
        model: picked.model,
        suggestOnly: opts.suggestOnly,
        jev,
      });
      if (!appendPromptLine(event, line)) {
        console.error(`[modelselect] announce skipped: could not edit prompt for session ${event.sessionID}`);
        return;
      }
      announced.set(event.sessionID, key);
    } catch (err) {
      console.error(`[modelselect] announce skipped: ${err?.message ?? err}`);
    }
  }

  // Keep OpenChamber's Jev routing categories (`~/.config/openchamber/
  // routing.json`) in sync with the plugin caches before every turn, in
  // every mode — best-effort, never breaks the turn. In `auto` mode this
  // sync IS the plugin's whole job: the categories just refreshed are what
  // routes the question, and the plugin then acts like `off`.
  async function syncRoutingNow() {
    try {
      const r = await syncRouting(routingIo);
      if (r.written && opts.verbose) console.log('[modelselect] routing.json synced');
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] routing sync skipped: ${err?.message ?? err}`);
    }
  }

  // Last known task for a session: the per-turn status file first (mode
  // `on` rewrites it every turn), then the continuation history. Returns
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

  // Paid `go` model for a session's last known task: null when the task
  // has no paid alternative. `entry.go` itself is often free by the
  // free-first policy, so the first paid `go_ranked` row wins — otherwise
  // the flip would re-select the exhausted tier. Shared by the
  // non-virtual flip and the virtual retry re-point.
  async function goRefForSession(sessionID) {
    const where = sessionTask(sessionID);
    if (!where) return null;
    const { config } = await loadConfig(opts, cacheDir);
    const table = config && (config['task-types'] ?? config.task_types);
    const name = Object.keys(table || {}).find((k) => k.toLowerCase() === where.taskType.toLowerCase());
    const entry = name ? table[name] : null;
    if (!entry) {
      if (opts.verbose) console.log(`[modelselect] free exhausted but no go model for task=${where.taskType}`);
      return null;
    }
    let picked = null;
    try {
      const { firstPaidModel } = require('./shared/routing');
      picked = firstPaidModel(entry) || entry.go;
    } catch {
      picked = entry.go;
    }
    if (!picked) {
      if (opts.verbose) console.log(`[modelselect] free exhausted but no go model for task=${where.taskType}`);
      return null;
    }
    return { ref: splitModelRef(picked), where };
  }

  // Flip a session to the configured `go` model for its task type
  // (fail-soft after free-tier exhaustion). Best-effort: returns true only
  // when a go model was found and the switch persisted; also refreshes the
  // status file so the Work Status view reflects tier=go + the latch.
  async function switchSessionToGo(sessionID) {
    try {
      const found = await goRefForSession(sessionID);
      if (!found) return false;
      const { ref, where } = found;
      await ctx.session.switchModel({ sessionID, model: { providerID: ref.providerID, id: ref.id } });
      applied.set(sessionID, `${ref.providerID}/${ref.id}`);
      const prev = where.prev || {};
      writeStatus(cacheDir, sessionID ?? 'default', {
        taskType: prev.taskType ?? where.taskType,
        tier: 'go',
        model: `${ref.providerID}/${ref.id}`,
        jev: prev.jev ?? null,
        goOk: prev.goOk ?? null,
        think: prev.think ?? null,
        freeExhausted: true,
        source: prev.source ?? '',
        suggestOnly: opts.suggestOnly,
      });
      return true;
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] free-exhaustion flip skipped: ${err?.message ?? err}`);
      return false;
    }
  }

  // Virtual free-exhaustion recovery: the session must STAY on
  // opencode/auto, so instead of persisting go we re-point the retry
  // event's model ref in place (same runtime-mutable pattern the context
  // hook uses; the type is compile-time readonly). Best-effort: if the ref
  // is not a writable object the armed retry still runs and attempt 2
  // re-resolves through the context hook, where the fresh latch prefers
  // go. Never throws.
  async function rePointRetryToGo(event) {
    try {
      const found = await goRefForSession(event.sessionID);
      if (!found || !event.model || typeof event.model !== 'object') return;
      event.model.providerID = found.ref.providerID;
      event.model.id = found.ref.id;
      if (opts.verbose) {
        console.log(`[modelselect] virtual retry re-pointed to ${found.ref.providerID}/${found.ref.id}`);
      }
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] virtual retry re-point skipped: ${err?.message ?? err}`);
    }
  }

  // Register a free-side exhaustion: latch the observation (quota uses a
  // 12h window, rate limiting uses a 1h window — read by routing sync +
  // resolveModel), refresh routing.json right away, and on the first
  // failure per session while mode `on` (or on a virtual pick, which
  // bypasses the mode) recover: non-virtual sessions flip to their task's
  // go model, virtual sessions stay on opencode/auto and only arm the
  // forced retry. Zen publishes no free-quota endpoint
  // (anomalyco/opencode#18648), so the failed real request IS the check.
  async function noteFreeExhaustion(sessionID, ref, detail, kind = 'exhaustion') {
    const rid = ref && (ref.id ?? ref.modelID);
    markFreeQuota(cacheDir, {
      kind,
      model: ref && rid ? `${ref.providerID}/${rid}` : null,
      detail,
    });
    await syncRoutingNow();
    if (!sessionID || freeFlipped.has(sessionID)) return;
    const virtual = virtualSessions.has(sessionID);
    if ((readMode(cacheDir) !== 'on' && !virtual) || opts.suggestOnly) return;
    freeFlipped.add(sessionID);
    const cause = kind === 'rate-limit' ? 'rate-limited' : 'exhausted';
    if (virtual) {
      // Never switchModel here: persisting go would unstick the virtual
      // pick (the session must keep re-routing every turn). Arm the one
      // forced retry; the retry hook re-points event.model in place.
      freeRetry.set(sessionID, Date.now());
      console.log(`[modelselect] free tier ${cause} (${detail}) — virtual session stays on ${VIRTUAL_REF}, retry armed`);
      return;
    }
    if (await switchSessionToGo(sessionID)) {
      freeRetry.set(sessionID, Date.now());
      console.log(`[modelselect] free tier ${cause} (${detail}) — session flipped to go`);
    }
  }

  console.log(
    `[modelselect] loaded (tier=${opts.tier} host=${host.host}/${host.source} virtual=${virtualRegistered ? 'on' : 'off'} token-source=${opts.tokenSource || 'none'} announce=${opts.announce} verbose=${opts.verbose} suggestOnly=${opts.suggestOnly})`,
  );

  await ctx.session.hook('prompt', async (event) => {
    try {
      // Sync OpenChamber routing before every question, then read the mode.
      await syncRoutingNow();
      const hookMode = readMode(cacheDir);
      // Only `on` announces: `off` pauses everything; `auto` refreshed
      // routing.json above and now acts like off (OpenChamber routes).
      // Virtual sessions bypass the mode (the picker is the switch) — they
      // announce like `on`. First turn on a virtual pick can miss this
      // (the prompt hook runs before the context hook marks the session);
      // the announce then lands on the next turn instead.
      if (hookMode !== 'on' && !virtualSessions.has(event.sessionID)) return;
      // v2 event: { sessionID, messageID, prompt: { text, files?, agents? },
      // delivery }. `event.agent` does not exist here — the agent tag comes
      // from prompt mentions (best-effort; undefined when absent).
      const text = promptTextFromPrompt(event.prompt);
      const files = filesFromPrompt(event.prompt);
      const agent = agentFromPrompt(event.prompt) ?? event.agent;
      if (text.trim() && event.sessionID) prompts.set(event.sessionID, text);
      await maybeAnnounce(event, text, { files, agent });
    } catch {
      // never break the session
    }
  });

  await ctx.session.hook('context', async (event) => {
    try {
      const sessionID = event.sessionID;
      // Track the virtual pick BEFORE any mode gate: `opencode/auto`
      // bypasses mode.json entirely (the picker is the switch), and the
      // free-exhaustion paths consult virtualSessions because their
      // http/retry events carry the post-mutation (real) model ref.
      const virtual = isVirtualRef(event.model);
      if (sessionID) {
        if (virtual) virtualSessions.add(sessionID);
        else virtualSessions.delete(sessionID);
      }
      // Sync OpenChamber routing first (fresh categories for this turn),
      // then apply the mode — unless this turn is the virtual pick, which
      // routes like `on` in every mode.
      await syncRoutingNow();
      const mode = readMode(cacheDir);
      if (!virtual && mode === 'off') {
        if (opts.verbose) console.log(`[modelselect] mode=off: routing skipped for session=${sessionID}`);
        return;
      }
      if (!virtual && mode === 'auto') {
        // The sync above refreshed `~/.config/openchamber/routing.json` —
        // that is the whole job in auto mode: OpenChamber's Jev routing
        // owns the pick from here, the plugin acts like off (no resolve,
        // no status write, no announce, no model mutation).
        if (opts.verbose) {
          console.log(`[modelselect] mode=auto: routing synced, plugin hands off session=${sessionID}`);
        }
        return;
      }
      const prompt = prompts.get(sessionID) ?? promptTextFromMessages(event.messages);
      const assistantSnippet = lastAssistantSnippet(event.messages, 1000);
      const { taskType, jev } = await resolveTask({
        sessionID,
        text: prompt,
        files: [],
        agent: event.agent,
        assistantSnippet,
      });
      const picked = await resolveModel({ taskType, opts, cacheDir });
      const ref = splitModelRef(picked.model);
      const key = `${ref.providerID}/${ref.id}`;
      writeStatus(cacheDir, sessionID ?? 'default', {
        taskType: picked.taskType,
        tier: picked.tier,
        model: picked.model,
        jev,
        goOk: picked.goOk ?? null,
        think: picked.think ?? null,
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
        if (virtual && sessionID) lastVirtualPick.set(sessionID, { providerID: ref.providerID, id: ref.id });
        return;
      }
      // 1. In-flight turn: mutate Model.Ref fields in place (bookkeeping
      // for logs/announce/status — the wire is decided by the
      // `http.request` overlay for virtual sessions and by persistence
      // for the rest).
      if (event.model && typeof event.model === 'object') {
        event.model.providerID = ref.providerID;
        event.model.id = ref.id;
      }
      if (virtual && sessionID) lastVirtualPick.set(sessionID, { providerID: ref.providerID, id: ref.id });
      // 2. Future turns: persist like the model picker does (best-effort).
      //    NEVER for virtual sessions: switchModel would replace
      //    opencode/auto and the pick would stop re-routing.
      if (!virtual && sessionID && applied.get(sessionID) !== key) {
        try {
          await ctx.session.switchModel({ sessionID, model: { providerID: ref.providerID, id: ref.id } });
          applied.set(sessionID, key);
        } catch (err) {
          if (opts.verbose) console.log(`[modelselect] switchModel skipped: ${err?.message ?? err}`);
        }
      }
      if (opts.verbose) {
        console.log(
          `[modelselect] task=${picked.taskType} tier=${picked.tier} model=${key} jev=${jev}${virtual ? ` (virtual ${VIRTUAL_REF})` : ''}`,
        );
      }
    } catch (err) {
      console.error(`[modelselect] keeping current model: ${err?.message ?? err}`);
    }
  });

  // Auxiliary requests (title/compaction/generate) bypass the `context`
  // hook. They still get the session's resolved pick stamped on
  // `event.model` for consistency, but that mutation is cosmetic — what
  // actually routes virtual sessions is the `http.request` overlay below.
  // The on-the-spot resolve primes `lastVirtualPick` for title-first
  // sessions. Non-virtual sessions keep their own models here, as before.
  for (const aux of ['title', 'compaction', 'generate']) {
    await ctx.session.hook(aux, async (event) => {
      try {
        const sessionID = event.sessionID;
        if (!sessionID || !isVirtualRef(event.model)) return;
        let pick = lastVirtualPick.get(sessionID);
        if (!pick) {
          const { taskType } = await resolveTask({
            sessionID,
            text: prompts.get(sessionID) ?? '',
            files: [],
            agent: undefined,
            assistantSnippet: '',
          });
          const picked = await resolveModel({ taskType, opts, cacheDir });
          const ref = splitModelRef(picked.model);
          pick = { providerID: ref.providerID, id: ref.id };
          lastVirtualPick.set(sessionID, pick);
        }
        if (event.model && typeof event.model === 'object') {
          event.model.providerID = pick.providerID;
          event.model.id = pick.id;
        }
      } catch {
        // never break the session
      }
    });
  }

  // Virtual dispatch overlay: `event.model` mutation is cosmetic — the
  // outgoing request carries the persisted session model (proven live:
  // primaries showed the resolved pick in hooks yet the wire still sent
  // `auto`). For virtual sessions, write the decided model into the
  // outgoing body here, where it actually takes effect ("raw HTTP body
  // overlays apply after protocol lowering"). The session stays on
  // `opencode/auto`; only the wire sees the pick. Resolves on the spot
  // when no pick exists yet and re-resolves when the stored pick just
  // hit a fresh exhaustion latch, so every physical attempt (including
  // armed retries, which do not re-run the context hook) carries a live
  // decision. Same-provider only: the endpoint stays pinned to the
  // session model, so cross-provider picks persist instead (the session
  // then leaves virtual mode and routes normally). Non-virtual sessions
  // are untouched.
  async function overlayVirtualBody(event) {
    try {
      const sessionID = event.sessionID;
      if (!sessionID) return;
      const sessionModel = event.model && typeof event.model === 'object' ? event.model : null;
      if (!virtualSessions.has(sessionID) && !isVirtualRef(sessionModel)) return;
      let pick = lastVirtualPick.get(sessionID);
      if (
        !pick ||
        (isFreeModelRef(pick, readModelTable(cacheDir)) && isFreeQuotaFresh(cacheDir, Date.now()))
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
        const picked = await resolveModel({ taskType, opts, cacheDir });
        const ref = splitModelRef(picked.model);
        pick = { providerID: ref.providerID, id: ref.id };
        lastVirtualPick.set(sessionID, pick);
      }
      if (!sessionModel || pick.providerID !== sessionModel.providerID) {
        try {
          await ctx.session.switchModel({ sessionID, model: { providerID: pick.providerID, id: pick.id } });
          applied.set(sessionID, `${pick.providerID}/${pick.id}`);
          virtualSessions.delete(sessionID);
          if (opts.verbose) {
            console.log(
              `[modelselect] virtual pick is cross-provider — persisted ${pick.providerID}/${pick.id}, leaving virtual mode`,
            );
          }
        } catch (err) {
          if (opts.verbose) console.log(`[modelselect] virtual persist skipped: ${err?.message ?? err}`);
        }
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
      if (!body || typeof body !== 'object' || body.model !== VIRTUAL_MODEL) return;
      body.model = pick.id;
      try {
        event.request = new Request(req, { body: JSON.stringify(body) });
      } catch {
        return;
      }
      if (opts.verbose) {
        console.log(`[modelselect] virtual overlay → ${pick.providerID}/${pick.id} (kind=${event.kind || '-'})`);
      }
    } catch {
      // never break the session
    }
  }
  await ctx.session.hook('http.request', overlayVirtualBody);

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
      const ref = event.model;
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
  // attempt cap bounds anything else — this can never loop. Also the
  // fallback when a failure arrives without a response we classified.
  await ctx.session.hook('retry', async (event) => {
    try {
      const armedAt = freeRetry.get(event.sessionID);
      if (armedAt !== undefined) {
        freeRetry.delete(event.sessionID);
        if (Date.now() - armedAt <= FREE_RETRY_TTL_MS) {
          if (virtualSessions.has(event.sessionID)) await rePointRetryToGo(event);
          event.decision = { retry: true, delay: 0 };
          if (opts.verbose) console.log(`[modelselect] retrying on go after free exhaustion session=${event.sessionID}`);
        }
        return;
      }
      const err = event.error;
      const outcome = classifyFreeFailure(err?.status, err?.message ?? '');
      if (!outcome.exhausted) return;
      if (!isFreeModelRef(event.model, readModelTable(cacheDir))) return;
      await noteFreeExhaustion(
        event.sessionID,
        event.model,
        `retry ${err?.type ?? 'error'}`,
        outcome.rateLimited ? 'rate-limit' : 'exhaustion',
      );
      const now = freeRetry.get(event.sessionID);
      if (now !== undefined && Date.now() - now <= FREE_RETRY_TTL_MS) {
        freeRetry.delete(event.sessionID);
        if (virtualSessions.has(event.sessionID)) await rePointRetryToGo(event);
        event.decision = { retry: true, delay: 0 };
      }
    } catch {
      // never break the session
    }
  });
}

module.exports = { id: ID, setup };
module.exports.default = module.exports;

