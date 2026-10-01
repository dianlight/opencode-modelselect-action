'use strict';

/**
 * Opencode Modelselect — preselect step for downstream workflows.
 *
 * Inputs (via INPUT_* env vars):
 *   task-type       Task class, matched case-insensitively against the
 *                   `task-types` keys of the central model config.
 *   tier            `go` (paid), `free` or `auto`. Defaults to `auto`
 *                   when a token is available, else `free`.
 *                   `auto` prefers free when reachable and falls back to
 *                   Go (or vice versa with `auto-preference`), polling the
 *                   live usage endpoints until `max-wait-seconds` expires.
 *   opencode-token  Token used only by tier=`auto` to query live usage.
 *                   Also read from OPENCODE_API_KEY when the input is empty.
 *                   Never logged.
 *   auto-preference `free-first` (default) or `go-first`.
 *   max-wait-seconds Max seconds tier=`auto` waits for quota before failing
 *                   (default 0 = fail fast). Polls every `poll-interval-seconds`.
 *   poll-interval-seconds Seconds between usage re-checks (default 60).
 *   usage-url       Go usage endpoint (default
 *                   https://opencode.ai/zen/go/v1/usage).
 *   probe-url       Zen chat endpoint used for the free availability probe
 *                   (default https://opencode.ai/zen/v1/chat/completions).
 *   probe-responses-url
 *                   Zen responses endpoint probed in parallel for free models
 *                   served there (e.g. muse-spark *-free). Defaults to
 *                   probe-url with /chat/completions swapped for /responses.
 *   config-url      Remote URL of the central model config.
 *   config-path     Local path (relative to GITHUB_WORKSPACE) preferred
 *                   over the remote URL when present.
 *   fallback-model  Optional escape hatch when the task-type has no entry.
 *   max-cost        Optional budget cap as blended $/1M: an over-budget pick
 *                   is replaced by the best-scoring ranked model within budget.
 *
 * Outputs (via GITHUB_OUTPUT):
 *   model, model-go, model-free, model-cost, config-source, task-type,
 *   tier-selected
 *
 * Fail-closed: exits non-zero when no model can be resolved and no
 * fallback-model was given. No default models exist.
 */

const fs = require('node:fs');
const path = require('node:path');
const { selectWithinBudget } = require('./shared/core/budget');
const { parseGoUsageWindows, goWindowsExhausted, classifyFreeProbe } = require('./shared/core/probe');

const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const DEFAULT_PROBE_URL = 'https://opencode.ai/zen/v1/chat/completions';
const DEFAULT_PROBE_RESPONSES_URL = 'https://opencode.ai/zen/v1/responses';

function getInput(name, { required = false, fallback = '' } = {}) {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  const value = (process.env[key] ?? fallback).trim();
  if (required && !value) {
    fail(`Input '${name}' is required but was empty.`);
  }
  return value;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function warn(message) {
  console.log(`::warning::${message}`);
}

function notice(message) {
  console.log(`::notice::${message}`);
}

function writeOutputs(outputs) {
  const target = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v ?? ''}`);
  if (!target) {
    // Local testing without the Actions runner: print to stdout.
    for (const line of lines) console.log(line);
    return;
  }
  fs.appendFileSync(target, `${lines.join('\n')}\n`, 'utf8');
}

function loadLocalConfig(workspace, configPath) {
  const file = path.isAbsolute(configPath)
    ? configPath
    : path.join(workspace, configPath);
  if (!fs.existsSync(file)) return null;
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), file };
  } catch (err) {
    fail(`Invalid or unreadable model config ${file}: ${err.message}`);
  }
  return null;
}

async function fetchRemoteConfig(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'opencode-modelselect-action/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'opencode-modelselect-action/1.0',
  };
}

async function checkGoAvailability(token, usageUrl) {
  let res;
  try {
    res = await fetchWithTimeout(usageUrl, { headers: authHeaders(token) });
  } catch (err) {
    return { available: null, reason: `go usage unreachable (${err?.message ?? err})` };
  }
  if (res.status === 401) {
    // Don't fail hard: the token may be valid for the other tier
    // (e.g. a Go-only key probing the free endpoint). Let the caller
    // try the next tier; it fails only when every tier rejects auth.
    return {
      available: false,
      reason: 'go rejected (401): token invalid or wrong scope for Go usage',
      authFailed: true,
    };
  }
  if (res.status === 403) {
    return { available: false, reason: 'go 403 (no active Go subscription)' };
  }
  if (res.status === 404) {
    return { available: false, reason: 'go usage endpoint not found (no Go plan?)' };
  }
  if (res.status === 429) {
    return { available: false, reason: 'go rate-limited (429)' };
  }
  if (!res.ok) {
    return { available: null, reason: `go usage HTTP ${res.status}` };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { available: null, reason: 'go usage returned invalid JSON' };
  }
  const windows = parseGoUsageWindows(data);
  if (!windows) {
    return { available: null, reason: 'go usage returned an unknown payload shape' };
  }
  if (goWindowsExhausted(windows)) {
    const summary = windows
      .map((w) => `${w.name}=${w.percent === null ? '?' : `${w.percent}%`}`)
      .join(',');
    return { available: false, reason: `go quota exhausted (${summary})` };
  }
  return { available: true, reason: 'go quota available' };
}

async function probeOnce(token, url, body) {
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: null, text: '', error: err?.message ?? String(err) };
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  return { status: res.status, ok: res.ok, text };
}

async function checkFreeAvailability(token, probeUrl, probeResponsesUrl, freeModel) {
  // The central config stores engine-prefixed display names
  // (e.g. `opencode/muse-spark-1.3-contributor-free`) for the OpenCode CLI,
  // but the Zen API expects the bare model id. Sending the prefixed name
  // gets a 401 "not supported" even for valid keys.
  const probeModel = String(freeModel ?? '').trim().split('/').pop();
  // Free models live on different Zen endpoints per model (chat/completions
  // vs responses, see the Zen docs endpoint table), so probe both shapes and
  // keep the best answer.
  const [chat, responses] = await Promise.all([
    probeOnce(token, probeUrl, {
      model: probeModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    }),
    probeOnce(token, probeResponsesUrl, {
      model: probeModel,
      input: 'ping',
      max_output_tokens: 1,
    }),
  ]);
  const ranked = [classifyFreeProbe(chat), classifyFreeProbe(responses)];
  const reason =
    ranked[0].reason === ranked[1].reason
      ? ranked[0].reason
      : `${ranked[0].reason}; alt: ${ranked[1].reason}`;
  if (ranked.some((r) => r.state === 'available')) {
    return { available: true, selectable: false, authFailed: false, reason };
  }
  if (ranked.some((r) => r.state === 'selectable')) {
    return { available: null, selectable: true, authFailed: false, reason };
  }
  if (ranked.some((r) => r.state === 'exhausted' || r.state === 'unavailable')) {
    return { available: false, selectable: false, authFailed: false, reason };
  }
  if (ranked.every((r) => r.state === 'authFailed')) {
    // Don't fail hard: the token may still be valid for Go. The caller
    // fails only when every tier rejects auth.
    return { available: false, selectable: false, authFailed: true, reason };
  }
  return { available: null, selectable: false, authFailed: false, reason };
}

async function resolveAutoTier({
  goModel,
  freeModel,
  token,
  usageUrl,
  probeUrl,
  probeResponsesUrl,
  preference,
  maxWaitSec,
  pollIntervalSec,
}) {
  const order = preference === 'go-first' ? ['go', 'free'] : ['free', 'go'];
  const deadline = Date.now() + maxWaitSec * 1000;
  const reasons = { go: '', free: '' };
  // A tier is pickable when it is proven available (Go quota ok, free probe
  // 2xx) or selectable (free session-gate: the key is accepted and the free
  // route exists; free models serve the downstream OpenCode step even while
  // Go quota remains). Preference order decides: the preferred pickable
  // tier wins without consulting the other.
  const pickable = (r) => r.available || r.selectable;
  for (;;) {
    const authFailed = { go: false, free: false };
    const seen = {};
    for (const t of order) {
      if (t === 'go') {
        if (!goModel) {
          reasons.go = 'not configured';
          continue;
        }
        const r = await checkGoAvailability(token, usageUrl);
        reasons.go = r.reason;
        if (r.authFailed) authFailed.go = true;
        seen.go = r;
      } else {
        if (!freeModel) {
          reasons.free = 'not configured';
          continue;
        }
        const r = await checkFreeAvailability(token, probeUrl, probeResponsesUrl, freeModel);
        reasons.free = r.reason;
        if (r.authFailed) authFailed.free = true;
        seen.free = r;
      }
      if (pickable(seen[t])) return { tier: t, model: t === 'go' ? goModel : freeModel };
    }
    // Every configured tier rejected the token: retrying won't help.
    const goRejected = !goModel || authFailed.go;
    const freeRejected = !freeModel || authFailed.free;
    if ((goModel || freeModel) && goRejected && freeRejected) {
      fail("Input/token for tier='auto' rejected (401): invalid opencode-token.");
    }
    if (Date.now() >= deadline) break;
    const waitMs = Math.min(pollIntervalSec * 1000, Math.max(0, deadline - Date.now()));
    notice(
      `tier='auto': free[${reasons.free || '?'}] go[${reasons.go || '?'}]; ` +
        `retrying in ${Math.round(waitMs / 1000)}s.`,
    );
    if (waitMs > 0) await sleep(waitMs);
    else break;
  }
  return { tier: null, model: null, reasons };
}

async function main() {
  const taskTypeInput = getInput('task-type', { required: true });
  const tierInput = getInput('tier');
  const configUrl = getInput('config-url');
  const configPath = getInput('config-path', { fallback: 'data/model-config.json' });
  const fallbackModel = getInput('fallback-model');
  const maxCostInput = getInput('max-cost');
  const tokenInput = getInput('opencode-token');
  const token = tokenInput || (process.env.OPENCODE_API_KEY ?? '').trim();
  // Default tier: probe live quota when a token is available, else free.
  const tier = (tierInput || (token ? 'auto' : 'free')).toLowerCase();
  const preference = (
    getInput('auto-preference', { fallback: 'free-first' }) || 'free-first'
  ).toLowerCase();
  const usageUrl =
    getInput('usage-url', { fallback: DEFAULT_USAGE_URL }) || DEFAULT_USAGE_URL;
  const probeUrl =
    getInput('probe-url', { fallback: DEFAULT_PROBE_URL }) || DEFAULT_PROBE_URL;
  // Responses-API probe for free models served there (e.g. muse-spark
  // *-free). Empty means derive from probe-url, or reuse it when it is not
  // a chat/completions URL (as in tests with mock servers).
  let probeResponsesUrl = getInput('probe-responses-url');
  if (!probeResponsesUrl) {
    const derived = probeUrl.replace(/\/chat\/completions\/?$/, '/responses');
    probeResponsesUrl = derived !== probeUrl ? derived : probeUrl;
  }
  if (!probeResponsesUrl) probeResponsesUrl = DEFAULT_PROBE_RESPONSES_URL;
  const maxWaitInput = getInput('max-wait-seconds');
  const pollIntervalInput = getInput('poll-interval-seconds');

  if (tier !== 'go' && tier !== 'free' && tier !== 'auto') {
    fail(`Input 'tier' must be 'go', 'free' or 'auto', got '${tier}'.`);
  }
  if (preference !== 'free-first' && preference !== 'go-first') {
    fail(`Input 'auto-preference' must be 'free-first' or 'go-first', got '${preference}'.`);
  }
  let maxWaitSec = 0;
  if (maxWaitInput) {
    maxWaitSec = Number(maxWaitInput);
    if (!Number.isFinite(maxWaitSec) || maxWaitSec < 0) {
      fail(`Input 'max-wait-seconds' must be a non-negative number of seconds, got '${maxWaitInput}'.`);
    }
  }
  let pollIntervalSec = 60;
  if (pollIntervalInput) {
    pollIntervalSec = Number(pollIntervalInput);
    if (!Number.isFinite(pollIntervalSec) || pollIntervalSec <= 0) {
      fail(`Input 'poll-interval-seconds' must be a positive number of seconds, got '${pollIntervalInput}'.`);
    }
  }
  if (tier === 'auto' && !token) {
    fail(
      "Input 'tier' is 'auto' but no token was given: pass 'opencode-token' " +
        'or set OPENCODE_API_KEY.',
    );
  }

  let maxCost = null;
  if (maxCostInput) {
    maxCost = Number(maxCostInput);
    if (!Number.isFinite(maxCost) || maxCost < 0) {
      fail(`Input 'max-cost' must be a non-negative number (blended $/1M), got '${maxCostInput}'.`);
    }
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  let config = null;
  let source = '';

  const local = loadLocalConfig(workspace, configPath);
  if (local) {
    config = local.data;
    source = 'local';
    notice(`Loaded model config from ${local.file}`);
  } else if (configUrl) {
    const remote = await fetchRemoteConfig(configUrl);
    if (remote) {
      config = remote;
      source = 'remote';
      notice(`Loaded model config from ${configUrl}`);
    }
  }

  if (!config) {
    fail(
      `Central model config unreachable (${configUrl || 'no config-url'}) ` +
        'and no local copy; cannot resolve a model.',
    );
  }

  const table = config['task-types'] ?? config.task_types;
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    fail(
      "Invalid model config: top-level 'task-types' object is missing. " +
        'The config is keyed by task-type only.',
    );
  }

  const key = Object.keys(table).find(
    (k) => k.toLowerCase() === taskTypeInput.toLowerCase(),
  );

  let goModel = '';
  let freeModel = '';
  let entry = null;
  if (key) {
    entry = table[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`Invalid model config: task-type '${key}' must be an object.`);
    }
    for (const t of ['go', 'free']) {
      const v = entry[t];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        fail(`Invalid model config: task-type '${key}' tier '${t}' must be a string.`);
      }
    }
    goModel = entry.go || '';
    freeModel = entry.free || '';
  }

  let tierSelected = tier;
  let model = tier === 'auto' ? '' : tier === 'free' ? freeModel : goModel;
  let modelCost = '';
  let fromFallback = false;
  if (tier === 'auto') {
    if (!key) {
      if (fallbackModel) {
        warn(
          `No model configured for task-type='${taskTypeInput}'; using fallback-model.`,
        );
        model = fallbackModel;
        source = `${source}+fallback`;
        fromFallback = true;
      } else {
        fail(
          `No model resolved for task-type='${taskTypeInput}' tier='auto' ` +
            `(source: ${source}); add a '${taskTypeInput}' entry to data/model-config.json.`,
        );
      }
    } else if (!goModel && !freeModel) {
      if (fallbackModel) {
        warn(
          `No model configured for task-type='${key}'; using fallback-model.`,
        );
        model = fallbackModel;
        source = `${source}+fallback`;
        fromFallback = true;
      } else {
        fail(
          `No model resolved for task-type='${key}' tier='auto' ` +
            `(source: ${source}); add go/free entries to data/model-config.json.`,
        );
      }
    } else {
      const picked = await resolveAutoTier({
        goModel,
        freeModel,
        token,
        usageUrl,
        probeUrl,
        probeResponsesUrl,
        preference,
        maxWaitSec,
        pollIntervalSec,
      });
      if (!picked.model) {
        if (fallbackModel) {
          warn(
            `tier='auto' found no available model for task-type='${key}' ` +
              `(free[${picked.reasons.free || '?'}] go[${picked.reasons.go || '?'}], ` +
              `preference=${preference}, waited ${maxWaitSec}s); using fallback-model.`,
          );
          model = fallbackModel;
          source = `${source}+fallback`;
          fromFallback = true;
        } else {
          fail(
            `No model available for task-type='${key}' tier='auto' ` +
              `(free[${picked.reasons.free || '?'}] go[${picked.reasons.go || '?'}], ` +
              `preference=${preference}, waited ${maxWaitSec}s); ` +
              'retry later, raise max-wait-seconds, or pass fallback-model.',
          );
        }
      } else {
        model = picked.model;
        tierSelected = picked.tier;
        notice(
          `tier='auto' selected '${tierSelected}' model '${model}' (preference=${preference}).`,
        );
      }
    }
  }
  if (!model && fallbackModel) {
    warn(
      `No model configured for task-type='${taskTypeInput}' tier='${tier}'; ` +
        'using fallback-model.',
    );
    model = fallbackModel;
    source = `${source}+fallback`;
    fromFallback = true;
  }
  if (!model) {
    fail(
      `No model resolved for task-type='${taskTypeInput}' tier='${tier}' ` +
        `(source: ${source}); add a '${taskTypeInput}' entry to data/model-config.json.`,
    );
  }

  if (maxCost !== null && !fromFallback) {
    let budgeted;
    try {
      budgeted = selectWithinBudget(entry, key, tierSelected, model, maxCost);
    } catch (err) {
      fail(err.message); // core throws; re-fail with the identical message
    }
    if (!budgeted.model) {
      if (fallbackModel) {
        warn(
          `No '${tierSelected}' model for task-type='${key}' fits max-cost=${maxCost} ` +
            `(${budgeted.hint}); using fallback-model.`,
        );
        model = fallbackModel;
        source = `${source}+fallback`;
      } else {
        fail(
          `No '${tierSelected}' model for task-type='${key}' fits max-cost=${maxCost} ` +
            `(${budgeted.hint}); raise max-cost or pass fallback-model.`,
        );
      }
    } else {
      if (budgeted.model !== model) {
        warn(
          `Resolved model '${model}' is over max-cost=${maxCost}; ` +
            `using cheaper '${budgeted.model}' ($${budgeted.cost}/1M).`,
        );
      }
      model = budgeted.model;
      modelCost = budgeted.cost;
    }
  }

  writeOutputs({
    model,
    'model-go': goModel,
    'model-free': freeModel,
    'model-cost': modelCost,
    'config-source': source,
    'task-type': key ?? taskTypeInput,
    'tier-selected': tierSelected,
  });
  notice(
    `Selected model '${model}' for task-type='${key ?? taskTypeInput}' tier='${tier}'` +
      (tier === 'auto' ? ` (selected: ${tierSelected})` : '') +
      (modelCost ? ` (blended $${modelCost}/1M)` : '') +
      '.',
  );
}

main().catch((err) => fail(`Unexpected error: ${err?.message ?? err}`));
