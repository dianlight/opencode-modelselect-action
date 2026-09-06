'use strict';

/**
 * Select OpenCode model — preselect step for downstream workflows.
 *
 * Inputs (via INPUT_* env vars):
 *   task-type       Task class, matched case-insensitively against the
 *                   `task-types` keys of the central model config.
 *   tier            `go` (paid) or `free`. Defaults to `go`.
 *   config-url      Remote URL of the central model config.
 *   config-path     Local path (relative to GITHUB_WORKSPACE) preferred
 *                   over the remote URL when present.
 *   fallback-model  Optional escape hatch when the task-type has no entry.
 *
 * Outputs (via GITHUB_OUTPUT):
 *   model, model-go, model-free, config-source, task-type
 *
 * Fail-closed: exits non-zero when no model can be resolved and no
 * fallback-model was given. No default models exist.
 */

const fs = require('node:fs');
const path = require('node:path');

const FETCH_TIMEOUT_MS = 15000;

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
      headers: { 'User-Agent': 'opencode-select-model/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const taskTypeInput = getInput('task-type', { required: true });
  const tier = (getInput('tier', { fallback: 'go' }) || 'go').toLowerCase();
  const configUrl = getInput('config-url');
  const configPath = getInput('config-path', { fallback: 'data/model-config.json' });
  const fallbackModel = getInput('fallback-model');

  if (tier !== 'go' && tier !== 'free') {
    fail(`Input 'tier' must be 'go' or 'free', got '${tier}'.`);
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
  if (key) {
    const entry = table[key];
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

  let model = tier === 'free' ? freeModel : goModel;
  if (!model && fallbackModel) {
    warn(
      `No model configured for task-type='${taskTypeInput}' tier='${tier}'; ` +
        'using fallback-model.',
    );
    model = fallbackModel;
    source = `${source}+fallback`;
  }
  if (!model) {
    fail(
      `No model resolved for task-type='${taskTypeInput}' tier='${tier}' ` +
        `(source: ${source}); add a '${taskTypeInput}' entry to data/model-config.json.`,
    );
  }

  writeOutputs({
    model,
    'model-go': goModel,
    'model-free': freeModel,
    'config-source': source,
    'task-type': key ?? taskTypeInput,
  });
  notice(`Selected model '${model}' for task-type='${key ?? taskTypeInput}' tier='${tier}'.`);
}

main().catch((err) => fail(`Unexpected error: ${err?.message ?? err}`));
