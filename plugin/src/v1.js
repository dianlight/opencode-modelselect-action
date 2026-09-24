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
 * - The chat-visible announce line (`announce` option, default `switch`)
 *   is pushed onto the message parts as an `ignored:true` text part with
 *   explicit IDs: OpenChamber renders it while `toModelMessages` and
 *   compaction skip it (zero-token display).
 */

const path = require('node:path');
const { inferTaskType, detectRepoSignals } = require('./shared/detect');
const { normalizeOptions, resolveModel, splitModelRef, formatAnnounce } = require('./shared/select');

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
    const announced = new Map(); // sessionID -> last announced "provider/id" key
    let announceSeq = 0;

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

    // Chat-visible pick line. `switch` emits only when the resolved pick
    // differs from the session's previously applied pick (sticky) and from
    // the last announced pick (covers suggestOnly, where sticky never moves);
    // first turn counts as a switch. Never throws — failures only log.
    function maybeAnnounce(msgInput, output, picked) {
      try {
        if (options.announce === 'off') return;
        const sessionID = msgInput?.sessionID ?? 'default';
        const key = picked.model;
        const prev = sticky.get(sessionID);
        const prevKey = prev ? `${prev.providerID}/${prev.id}` : null;
        if (options.announce === 'switch' && (key === prevKey || key === announced.get(sessionID))) {
          announced.set(sessionID, key);
          return;
        }
        const line = formatAnnounce({
          taskType: picked.taskType,
          tier: picked.tier,
          model: picked.model,
          suggestOnly: options.suggestOnly,
        });
        const parts = Array.isArray(output?.parts)
          ? output.parts
          : Array.isArray(output?.message?.parts)
            ? output.message.parts
            : null;
        if (!parts) return;
        announceSeq += 1;
        parts.push({
          type: 'text',
          id: `modelselect-${Date.now().toString(36)}-${announceSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          sessionID: msgInput?.sessionID,
          messageID: msgInput?.messageID,
          text: line,
          ignored: true,
        });
        announced.set(sessionID, key);
      } catch (err) {
        console.error(`[modelselect] announce skipped: ${err?.message ?? err}`);
      }
    }

    return {
      'chat.message': async (msgInput, output) => {
        try {
          const sessionID = msgInput?.sessionID ?? 'default';
          const prompt = promptTextFromParts(output?.parts);
          const files = filesFromParts(output?.parts);
          let ref = sticky.get(sessionID) ?? null;
          let picked = null;
          if (prompt.trim() || options.taskType !== 'auto') {
            const routed = await route(sessionID, prompt, files, msgInput?.agent);
            picked = routed.picked;
            if (options.suggestOnly) {
              // Trial mode: resolve everything but change nothing.
              const key = `${routed.ref.providerID}/${routed.ref.id}`;
              const currentTarget = output?.message?.model;
              const current =
                currentTarget && typeof currentTarget === 'object'
                  ? `${currentTarget.providerID}/${currentTarget.modelID}`
                  : '?';
              console.log(
                `[modelselect] (suggest-only) v1 session=${sessionID} task=${picked.taskType} tier=${picked.tier} would-select=${key} current=${current}`,
              );
              maybeAnnounce(msgInput, output, picked);
              return;
            }
            ref = routed.ref;
            // Announce before sticky.set: switch-mode compares against the
            // previously applied pick, and the first turn counts as a switch.
            maybeAnnounce(msgInput, output, picked);
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
