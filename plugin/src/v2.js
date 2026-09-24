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
 *   is appended to the prompt text in the `prompt` hook: v2 has no
 *   zero-token visible channel (`context` edits never render), so the
 *   terse line persists+renders (~15 tokens/turn).
 */

const path = require('node:path');
const { inferTaskType, detectRepoSignals } = require('./shared/detect');
const { normalizeOptions, resolveModel, splitModelRef, formatAnnounce } = require('./shared/select');

const ID = 'modelselect';

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

async function setup(ctx) {
  const opts = normalizeOptions(ctx.options ?? {});
  const directory = ctx.location?.directory ?? process.cwd();
  const cacheDir = cacheDirFor(directory);
  const repo = detectRepoSignals(scanRepo(directory));
  const prompts = new Map(); // sessionID -> last prompt text
  const applied = new Map(); // sessionID -> "provider/id" already persisted
  const announced = new Map(); // sessionID -> last announced "provider/id" key

  // Append the terse pick line to the prompt text. Handles the string form
  // plus common object shapes; returns false when nothing could be edited.
  function appendPromptLine(event, line) {
    if (typeof event.prompt === 'string') {
      event.prompt = `${event.prompt}\n${line}`;
      return true;
    }
    const p = event.prompt;
    if (p && typeof p === 'object') {
      if (Array.isArray(p.parts)) {
        p.parts.push({ type: 'text', text: line });
        return true;
      }
      if (typeof p.text === 'string') {
        p.text = `${p.text}\n${line}`;
        return true;
      }
      if (typeof p.content === 'string') {
        p.content = `${p.content}\n${line}`;
        return true;
      }
    }
    return false;
  }

  await ctx.session.hook('prompt', async (event) => {
    try {
      const text =
        typeof event.prompt === 'string'
          ? event.prompt
          : promptTextFromMessages(event.prompt?.parts ? [event.prompt] : []);
      if (text.trim() && event.sessionID) prompts.set(event.sessionID, text);
      // Chat-visible pick line. v2 has no zero-token visible channel:
      // context-hook edits never render, so the terse line is appended here
      // in the prompt hook (it persists+renders, ~15 tokens/turn). The
      // second resolve in the context hook is ~free (24h config cache +
      // 5min quota cache). `switch` (default) emits only when the pick
      // differs from the previously applied pick (applied) and the last
      // announced pick (covers suggestOnly, where applied never moves);
      // first turn counts as a switch. Never throws.
      if (opts.announce === 'off' || !text.trim() || !event.sessionID) return;
      try {
        const { taskType } = inferTaskType({
          prompt: text,
          files: [],
          repo,
          agent: event.agent,
          fixedTaskType: opts.taskType,
          agentTaskMap: opts.agentTaskMap,
          defaultTaskType: opts.defaultTaskType,
        });
        const picked = await resolveModel({ taskType, opts, cacheDir });
        const key = picked.model;
        if (
          opts.announce === 'switch' &&
          (key === applied.get(event.sessionID) || key === announced.get(event.sessionID))
        ) {
          announced.set(event.sessionID, key);
          return;
        }
        const line = formatAnnounce({
          taskType: picked.taskType,
          tier: picked.tier,
          model: picked.model,
          suggestOnly: opts.suggestOnly,
        });
        appendPromptLine(event, line);
        announced.set(event.sessionID, key);
      } catch (err) {
        console.error(`[modelselect] announce skipped: ${err?.message ?? err}`);
      }
    } catch {
      // never break the session
    }
  });

  await ctx.session.hook('context', async (event) => {
    try {
      const sessionID = event.sessionID;
      const prompt = prompts.get(sessionID) ?? promptTextFromMessages(event.messages);
      const { taskType } = inferTaskType({
        prompt,
        files: [],
        repo,
        agent: event.agent,
        fixedTaskType: opts.taskType,
        agentTaskMap: opts.agentTaskMap,
        defaultTaskType: opts.defaultTaskType,
      });
      const picked = await resolveModel({ taskType, opts, cacheDir });
      const ref = splitModelRef(picked.model);
      const key = `${ref.providerID}/${ref.id}`;
      if (opts.suggestOnly) {
        // Trial mode: resolve everything but change nothing.
        const current =
          event.model && typeof event.model === 'object'
            ? `${event.model.providerID}/${event.model.id}`
            : '?';
        console.log(
          `[modelselect] (suggest-only) task=${picked.taskType} tier=${picked.tier} would-select=${key} current=${current}`,
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
      if (opts.verbose) console.log(`[modelselect] task=${picked.taskType} tier=${picked.tier} model=${key}`);
    } catch (err) {
      console.error(`[modelselect] keeping current model: ${err?.message ?? err}`);
    }
  });
}

module.exports = { id: ID, setup };
module.exports.default = module.exports;
