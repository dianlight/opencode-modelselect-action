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
const { readMode, writeStatus, statusFile } = require('./shared/status');
const { syncRouting } = require('./shared/routing');
const { createRoutingIo } = require('./shared/routing-io');
const {
  classifyFreeFailure,
  isFreeModelRef,
  markFreeQuota,
  readModelTable,
} = require('./shared/freequota');

const ID = 'modelselect';
// Forced-retry arm window: a retry follows its failure within seconds, so
// an arm older than this (consumed late) is stale and must not fire.
const FREE_RETRY_TTL_MS = 60 * 1000;

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
  const opts = normalizeOptions(ctx.options ?? {});
  const directory = ctx.location?.directory ?? process.cwd();
  const cacheDir = cacheDirFor(directory);
  const routingIo = createRoutingIo(directory);
  const repo = detectRepoSignals(scanRepo(directory));
  const prompts = new Map(); // sessionID -> last prompt text
  const applied = new Map(); // sessionID -> "provider/id" already persisted
  const announced = new Map(); // sessionID -> last announced "provider/id" key
  const history = new Map(); // sessionID -> { task, prompt } last substantive turn
  const freeFlipped = new Set(); // sessions already flipped to go (process lifetime)
  const freeRetry = new Map(); // sessionID -> armedAt (epoch ms): one forced retry

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

  // Flip a session to the configured `go` model for its task type
  // (fail-soft after free-tier exhaustion). Best-effort: returns true only
  // when a go model was found and the switch persisted; also refreshes the
  // status file so the Work Status view reflects tier=go + the latch.
  async function switchSessionToGo(sessionID) {
    try {
      const where = sessionTask(sessionID);
      if (!where) return false;
      const { config } = await loadConfig(opts, cacheDir);
      const table = config && (config['task-types'] ?? config.task_types);
      const name = Object.keys(table || {}).find((k) => k.toLowerCase() === where.taskType.toLowerCase());
      const entry = name ? table[name] : null;
      if (!entry || !entry.go) {
        if (opts.verbose) console.log(`[modelselect] free exhausted but no go model for task=${where.taskType}`);
        return false;
      }
      const ref = splitModelRef(entry.go);
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

  // Register a free-side exhaustion: latch the observation (quota uses a
  // 12h window, rate limiting uses a 1h window — read by routing sync +
  // resolveModel), refresh routing.json right away, and on the first
  // failure per session while mode `on` flip the session to its go model
  // and arm exactly one forced retry so the turn resumes on the paid
  // alternative. Zen publishes no free-quota endpoint
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
    if (readMode(cacheDir) !== 'on' || opts.suggestOnly) return;
    freeFlipped.add(sessionID);
    if (await switchSessionToGo(sessionID)) {
      freeRetry.set(sessionID, Date.now());
      const cause = kind === 'rate-limit' ? 'rate-limited' : 'exhausted';
      console.log(`[modelselect] free tier ${cause} (${detail}) — session flipped to go`);
    }
  }

  console.log(
    `[modelselect] loaded (tier=${opts.tier} token-source=${opts.tokenSource || 'none'} announce=${opts.announce} verbose=${opts.verbose} suggestOnly=${opts.suggestOnly})`,
  );

  await ctx.session.hook('prompt', async (event) => {
    try {
      // Sync OpenChamber routing before every question, then read the mode.
      await syncRoutingNow();
      const hookMode = readMode(cacheDir);
      // Only `on` announces: `off` pauses everything; `auto` refreshed
      // routing.json above and now acts like off (OpenChamber routes).
      if (hookMode !== 'on') return;
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
      // Sync OpenChamber routing first (fresh categories for this turn),
      // then apply the mode.
      await syncRoutingNow();
      const mode = readMode(cacheDir);
      if (mode === 'off') {
        if (opts.verbose) console.log(`[modelselect] mode=off: routing skipped for session=${sessionID}`);
        return;
      }
      if (mode === 'auto') {
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
        return;
      }
      // 1. In-flight turn: mutate Model.Ref fields in place.
      if (event.model && typeof event.model === 'object') {
        event.model.providerID = ref.providerID;
        event.model.id = ref.id;
      }
      // 2. Future turns: persist like the model picker does (best-effort).
      if (sessionID && applied.get(sessionID) !== key) {
        try {
          await ctx.session.switchModel({ sessionID, model: { providerID: ref.providerID, id: ref.id } });
          applied.set(sessionID, key);
        } catch (err) {
          if (opts.verbose) console.log(`[modelselect] switchModel skipped: ${err?.message ?? err}`);
        }
      }
      if (opts.verbose) console.log(`[modelselect] task=${picked.taskType} tier=${picked.tier} model=${key} jev=${jev}`);
    } catch (err) {
      console.error(`[modelselect] keeping current model: ${err?.message ?? err}`);
    }
  });

  // Fail-soft: classify real free-side failures (Zen has no quota
  // endpoint to probe — the failed request IS the check; quota uses a 12h
  // latch, transient rate limiting uses a 1h latch in shared/freequota.js).
  // Only agent-loop (`primary`) traffic flips: title/compaction/generate
  // calls keep their own models.
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
        event.decision = { retry: true, delay: 0 };
      }
    } catch {
      // never break the session
    }
  });
}

module.exports = { id: ID, setup };
module.exports.default = module.exports;
