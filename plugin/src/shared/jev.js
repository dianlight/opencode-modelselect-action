'use strict';

/**
 * Optional Jev (TypeSafe System One) refinement for task-type routing.
 *
 * Disabled by default: when `opts.jevModel` is empty the heuristic result
 * passes through untouched — no network, no latency, no cost.
 *
 * When enabled (`jevModel: "jev-1.13"` or `"jev-1.13-free"`), a single
 * `choice` question is POSTed to the SystemOne endpoint
 * (`POST <jevEndpoint>` = `https://opencode.ai/zen/v1/systemone` by
 * default) with the current prompt as `state`. A confident answer
 * (`confidence >= jevThreshold`, default 0.6) replaces the heuristic
 * task-type; anything else (low confidence, unknown choice, network
 * error, missing token) fails open to the heuristic.
 *
 * Request/response shapes verified against:
 * - https://opencode.ai/v2/docs/console/models/ (Jev section: endpoint,
 *   `{ model, state, questions }` body, `choice`/`score`/`noul` types,
 *   `jev-1.13` / `jev-1.13-free` model ids)
 * - https://docs.typesafe.ai/primitives/choice (Choice answer:
 *   `answers.<id> = { type, choice, confidence, probabilities }`)
 */

const { TASK_TYPES } = require('./detect');
const { loadTaskTypes } = require('./tasktypes');

const DEFAULT_JEV_ENDPOINT = 'https://opencode.ai/zen/v1/systemone';
const DEFAULT_JEV_THRESHOLD = 0.6;
const DEFAULT_JEV_TIMEOUT_MS = 10000;
const JEV_STATE_MAX_CHARS = 4000;

// Offline fallback only: used when the remote task-types file is
// unreachable and no cache exists yet. The live criteria always come from
// data/task-types.json (see tasktypes.js) so new types need no code change.
const FALLBACK_JEV_CRITERIA = {
  plan: 'Planning, architecture, task breakdown',
  'issue-triage': 'Triage, label or route an issue',
  review: 'Review a diff or pull request',
  'ui-design': 'UI components, layout, CSS, design system',
  'ui-testing': 'E2E UI tests with Playwright or Cypress',
  'api-testing': 'REST API endpoints, integration tests',
  docs: 'README, changelog, documentation',
  debug: 'Crash, stack trace, bug reproduction and fix',
  refactor: 'Refactor, cleanup, tech debt',
  security: 'Vulnerability, CVE, XSS, hardening',
  code: 'Implement a feature, function or endpoint',
  'mechanical-engineer': 'CAD, OpenSCAD, mechanical design',
  generic: 'General work that fits no other class',
  'small-model': 'Trivial: commit message, title, summary',
};

function normalizeJevOptions(raw = {}) {
  const jevModel = String(
    raw.jevModel ?? raw['jev-model'] ?? raw.typesafeModel ?? raw['typesafe-model'] ?? '',
  ).trim();
  const jevEndpoint = String(raw.jevEndpoint ?? raw['jev-endpoint'] ?? DEFAULT_JEV_ENDPOINT).trim() || DEFAULT_JEV_ENDPOINT;
  const jevToken = String(
    raw.jevToken ?? raw['jev-token'] ?? raw.jevKey ?? raw['jev-key'] ?? '',
  ).trim();
  let jevThreshold = raw.jevThreshold ?? raw['jev-threshold'] ?? DEFAULT_JEV_THRESHOLD;
  jevThreshold = Number(jevThreshold);
  if (!Number.isFinite(jevThreshold) || jevThreshold < 0 || jevThreshold > 1) {
    throw new Error(`Invalid jevThreshold '${raw.jevThreshold ?? raw['jev-threshold']}' (want 0..1).`);
  }
  let jevTimeoutMs = raw.jevTimeoutMs ?? raw['jev-timeout-ms'] ?? DEFAULT_JEV_TIMEOUT_MS;
  jevTimeoutMs = Number(jevTimeoutMs);
  if (!Number.isFinite(jevTimeoutMs) || jevTimeoutMs <= 0) {
    throw new Error(`Invalid jevTimeoutMs '${raw.jevTimeoutMs ?? raw['jev-timeout-ms']}' (want > 0).`);
  }
  return { jevModel, jevEndpoint, jevToken, jevThreshold, jevTimeoutMs };
}

function buildJevState({ prompt, files, agent } = {}) {
  const parts = [];
  const text = String(prompt ?? '').trim();
  if (text) parts.push(`Task: ${text}`);
  if (agent) parts.push(`Agent: ${String(agent)}`);
  if (Array.isArray(files) && files.length) parts.push(`Files: ${files.map(String).join(', ')}`);
  const state = parts.join('\n').trim();
  return state.length > JEV_STATE_MAX_CHARS ? state.slice(0, JEV_STATE_MAX_CHARS) : state;
}

function buildJevQuestions(taskTypes) {
  const criteria = {};
  if (taskTypes && typeof taskTypes === 'object' && !Array.isArray(taskTypes)) {
    // Remote definitions: { name: { description } } from data/task-types.json.
    for (const [name, meta] of Object.entries(taskTypes)) {
      const key = String(name).toLowerCase().trim();
      if (!key) continue;
      criteria[key] =
        (meta && typeof meta === 'object'
          ? String(meta.description ?? meta.label ?? '').trim()
          : String(meta ?? '').trim()) || key;
    }
  } else {
    for (const t of TASK_TYPES) criteria[t] = FALLBACK_JEV_CRITERIA[t] ?? t;
  }
  return {
    task: {
      type: 'choice',
      instructions: 'Which task class best describes the user request?',
      criteria,
    },
  };
}

/** Extract { choice, confidence } from a SystemOne response; null when unusable. */
function parseJevAnswer(data) {
  const ans = data?.answers?.task ?? data?.answers?.taskType ?? data?.task;
  if (!ans || typeof ans !== 'object') return null;
  const choice = String(ans.choice ?? ans.value ?? ans.label ?? '').toLowerCase().trim();
  if (!choice) return null;
  const confidence = Number(ans.confidence ?? ans.probabilities?.[choice] ?? NaN);
  return {
    choice,
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
}

async function callJev({ state, opts, token, questions }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.jevTimeoutMs);
  try {
    const res = await fetch(opts.jevEndpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'opencode-modelselect-plugin/0.1',
      },
      body: JSON.stringify({ model: opts.jevModel, state, questions: questions ?? buildJevQuestions() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refine a heuristic task-type via Jev. Always resolves; never throws.
 * Returns { taskType, jev, status } where jev is null when heuristics were
 * kept and status is one of: off, no-token, empty, error, unknown,
 * lowconf, ok.
 *
 * `taskTypes` (remote `{ name: { description } }` map) overrides the choice
 * list; when omitted and `cacheDir` is given, the remote file is loaded
 * best-effort (same cache cadence as the model config). Anything unusable —
 * missing cache, unreachable remote — falls back to the static list, and
 * any failure still fails open to the heuristic.
 */
async function refineTaskTypeWithJev({ heuristic, prompt, files, agent, opts, token, taskTypes, cacheDir }) {
  if (!opts || !opts.jevModel) return { taskType: heuristic, jev: null, status: 'off' };
  const key = String(token || opts.jevToken || opts.token || '').trim();
  if (!key) return { taskType: heuristic, jev: null, status: 'no-token' };
  const state = buildJevState({ prompt, files, agent });
  if (!state) return { taskType: heuristic, jev: null, status: 'empty' };
  let defs = taskTypes ?? null;
  if (!defs && cacheDir) {
    try {
      ({ taskTypes: defs } = await loadTaskTypes(opts, cacheDir));
    } catch (err) {
      if (opts.verbose) console.log(`[modelselect] jev task-types skipped: ${err?.message ?? err}`);
      defs = null;
    }
  }
  const valid = defs ? Object.keys(defs) : TASK_TYPES;
  const questions = buildJevQuestions(defs);
  let parsed = null;
  try {
    const data = await callJev({ state, opts, token: key, questions });
    parsed = parseJevAnswer(data);
  } catch (err) {
    if (opts.verbose) console.log(`[modelselect] jev skipped: ${err?.message ?? err}`);
    return { taskType: heuristic, jev: null, status: 'error' };
  }
  if (!parsed || !valid.includes(parsed.choice)) {
    return { taskType: heuristic, jev: null, status: 'unknown' };
  }
  if (parsed.confidence !== null && parsed.confidence < opts.jevThreshold) {
    if (opts.verbose) console.log(`[modelselect] jev low confidence: ${parsed.choice} ${parsed.confidence}`);
    return { taskType: heuristic, jev: null, status: 'lowconf' };
  }
  if (opts.verbose) console.log(`[modelselect] jev task=${parsed.choice} conf=${parsed.confidence ?? '?'} (heuristic=${heuristic})`);
  return { taskType: parsed.choice, jev: parsed, status: 'ok' };
}

/**
 * Terse label for the announce line. ok -> `review@0.95`;
 * off/pinned pass through; anything else -> `kept:<reason>`.
 */
function jevLabel({ status, jev } = {}) {
  if (status === 'ok' && jev) {
    const c = jev.confidence;
    const conf = typeof c === 'number' && Number.isFinite(c) ? String(Math.round(c * 100) / 100) : '?';
    return `${jev.choice}@${conf}`;
  }
  if (status === 'off' || status === 'pinned') return status;
  if (!status) return null;
  return `kept:${status}`;
}

module.exports = {
  normalizeJevOptions,
  buildJevState,
  buildJevQuestions,
  parseJevAnswer,
  refineTaskTypeWithJev,
  jevLabel,
  DEFAULT_JEV_ENDPOINT,
  DEFAULT_JEV_THRESHOLD,
  DEFAULT_JEV_TIMEOUT_MS,
};
