'use strict';

/**
 * v1 entrypoint (package.json `main`). Served to OpenCode v1 via `server()`.
 * Object form requires OpenCode >= 1.18.29; older v1 releases expect a
 * function export — we do not support those.
 *
 * Model routing verified against @opencode-ai/plugin 1.18.x hook types:
 * - `chat.params` output has NO model field, so it cannot route.
 * - `chat.message` output.message carries the turn model: mutate its
 *   `providerID`/`modelID` fields IN PLACE (never replace the object —
 *   core may hold its own reference to it).
 * - The mutation only lasts one turn, so we keep a sticky per-session map
 *   and re-apply on every message (same pattern as opencode-key-model-router).
 */

const path = require('node:path');
const { inferTaskType, detectRepoSignals } = require('./shared/detect');
const { normalizeOptions, resolveModel, splitModelRef } = require('./shared/select');

function cacheDirFor(directory) {
  return path.join(String(directory || process.cwd()), '.opencode', '.modelselect-cache');
}

// Cheap sync repo scan (top-level markers only); full walk is not worth it
// per request. Cached per server() instance.
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

function promptTextFromParts(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

function filesFromParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const cands = [p.path, p.name, p.filename, p.file?.path];
    return cands.filter((c) => typeof c === 'string' && c);
  });
}

module.exports = {
  async server(input = {}, opts = {}) {
    const rawOpts = { ...opts, ...(input.options ?? {}) };
    const options = normalizeOptions(rawOpts);
    const directory = input.directory ?? process.cwd();
    const cacheDir = cacheDirFor(directory);
    const repo = detectRepoSignals(scanRepo(directory));
    const sticky = new Map(); // sessionID -> { providerID, modelID }

    async function route(sessionID, prompt, files, agent) {
      const { taskType } = inferTaskType({
        prompt,
        files,
        repo,
        agent,
        fixedTaskType: options.taskType,
        agentTaskMap: options.agentTaskMap,
        defaultTaskType: options.defaultTaskType,
      });
      const picked = await resolveModel({ taskType, opts: options, cacheDir });
      return { picked, ref: splitModelRef(picked.model) };
    }

    return {
      'chat.message': async (msgInput, output) => {
        try {
          const sessionID = msgInput?.sessionID ?? 'default';
          const prompt = promptTextFromParts(output?.parts);
          const files = filesFromParts(output?.parts);
          let ref = sticky.get(sessionID) ?? null;
          if (prompt.trim() || options.taskType !== 'auto') {
            const { picked, ref: fresh } = await route(sessionID, prompt, files, msgInput?.agent);
            if (options.suggestOnly) {
              // Trial mode: resolve everything but change nothing.
              const key = `${fresh.providerID}/${fresh.id}`;
              const currentTarget = output?.message?.model;
              const current =
                currentTarget && typeof currentTarget === 'object'
                  ? `${currentTarget.providerID}/${currentTarget.modelID}`
                  : '?';
              console.log(
                `[modelselect] (suggest-only) v1 session=${sessionID} task=${picked.taskType} tier=${picked.tier} would-select=${key} current=${current}`,
              );
              return;
            }
            ref = fresh;
            sticky.set(sessionID, ref);
          }
          const target = output?.message?.model;
          if (ref && target && typeof target === 'object') {
            target.providerID = ref.providerID;
            target.modelID = ref.id;
          }
          if (options.verbose) console.log(`[modelselect] v1 session=${sessionID} model=${ref?.providerID}/${ref?.id}`);
        } catch (err) {
          console.error(`[modelselect] keeping current model: ${err?.message ?? err}`);
        }
      },
    };
  },
};
