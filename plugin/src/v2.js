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
 */

const path = require('node:path');
const { inferTaskType, detectRepoSignals } = require('./shared/detect');
const { normalizeOptions, resolveModel, splitModelRef } = require('./shared/select');

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

  await ctx.session.hook('prompt', async (event) => {
    try {
      const text =
        typeof event.prompt === 'string'
          ? event.prompt
          : promptTextFromMessages(event.prompt?.parts ? [event.prompt] : []);
      if (text.trim() && event.sessionID) prompts.set(event.sessionID, text);
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
      });
      const picked = await resolveModel({ taskType, opts, cacheDir });
      const ref = splitModelRef(picked.model);
      // 1. In-flight turn: mutate Model.Ref fields in place.
      if (event.model && typeof event.model === 'object') {
        event.model.providerID = ref.providerID;
        event.model.id = ref.id;
      }
      // 2. Future turns: persist like the model picker does (best-effort).
      const key = `${ref.providerID}/${ref.id}`;
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
