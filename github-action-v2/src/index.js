'use strict';

/**
 * OpenCode + modelselect v2 action.
 *
 * The union of `dianlight/opencode-modelselect-action` (preselect + routing
 * rules) and `anomalyco/opencode/github` (run the agent in CI). Instead of
 * pinning one model for the whole job, it installs OpenCode, writes a global
 * opencode.json that loads the bundled modelselect plugin configured from
 * this action's inputs, and runs `opencode github run`. The plugin resolves
 * the model per turn and fails over at runtime when a model is disabled,
 * unavailable, exhausted or errors for any other reason.
 *
 * Inputs are read from INPUT_* env vars (GitHub Actions convention). The
 * OpenCode token is never written to the plugin config: it is taken from
 * `opencode-token` or inherited from OPENCODE_API_KEY in the environment.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function getInput(name, { fallback = '' } = {}) {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return String(process.env[key] ?? fallback).trim();
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
    for (const line of lines) console.log(line);
    return;
  }
  fs.appendFileSync(target, `${lines.join('\n')}\n`, 'utf8');
}

/** Only include inputs the caller actually set, so plugin defaults still apply. */
function setIf(value, target, key) {
  if (value !== '' && value !== undefined && value !== null) target[key] = value;
}

function boolInput(name, fallback = false) {
  const raw = getInput(name);
  if (raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1' || raw === 'yes';
}

function numberInput(name, fallback) {
  const raw = getInput(name);
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`Input '${name}' must be a number, got '${raw}'.`);
  return n;
}

/** Plugin option object from this action's modelselect/plugin inputs. */
function pluginOptions() {
  const options = {};
  setIf(getInput('task-type'), options, 'taskType');
  setIf(getInput('default-task-type'), options, 'defaultTaskType');
  setIf(getInput('tier'), options, 'tier');
  setIf(getInput('auto-preference'), options, 'autoPreference');
  setIf(getInput('fallback-model'), options, 'fallbackModel');
  if (getInput('max-cost') !== '') options.maxCost = numberInput('max-cost', 0);
  setIf(getInput('available-providers'), options, 'availableProviders');
  setIf(getInput('config-url'), options, 'configUrl');
  setIf(getInput('config-v2-url'), options, 'configV2Url');
  setIf(getInput('registry-url'), options, 'registryUrl');
  setIf(getInput('catalog-url'), options, 'catalogUrl');
  setIf(getInput('task-types-url'), options, 'taskTypesUrl');
  setIf(getInput('usage-url'), options, 'usageUrl');
  setIf(getInput('announce'), options, 'announce');
  setIf(getInput('jev-model'), options, 'jevModel');
  setIf(getInput('jev-endpoint'), options, 'jevEndpoint');
  setIf(getInput('openchamber'), options, 'openchamber');
  setIf(getInput('small-model-task'), options, 'smallModelTask');
  if (getInput('history-chars') !== '') options.historyChars = numberInput('history-chars', 2000);

  const refresh = getInput('config-refresh-minutes');
  if (refresh !== '') options.configRefreshMinutes = numberInput('config-refresh-minutes', 1440);
  const threshold = getInput('jev-threshold');
  if (threshold !== '') options.jevThreshold = numberInput('jev-threshold', 0.6);

  const mapRaw = getInput('agent-task-map');
  if (mapRaw) {
    try {
      options.agentTaskMap = JSON.parse(mapRaw);
    } catch (err) {
      fail(`Input 'agent-task-map' is not valid JSON: ${err.message}`);
    }
  }

  if (boolInput('verbose')) options.verbose = true;
  if (boolInput('suggest-only')) options.suggestOnly = true;
  if (boolInput('auto-small-model')) options.autoSmallModel = true;
  if (getInput('continuation') !== '' && !boolInput('continuation', true)) options.continuation = false;

  // Tokens are passed through the environment, never persisted to config.
  return options;
}

/**
 * `opencode github run` validates MODEL before plugins register their virtual
 * provider, so the virtual anchor cannot be passed as MODEL in CI. When the
 * caller leaves `model` empty, run the v1 select-model action with the same
 * inputs and use its resolved model as the explicit MODEL. The plugin still
 * receives every routing option and owns runtime failover. A caller may pass
 * a `modelselect/auto-*` anchor explicitly on hosts where it is resolvable.
 */
function preselectModel() {
  const selector = path.resolve(__dirname, '..', '..', 'github-action', 'src', 'index.js');
  if (!fs.existsSync(selector)) fail(`select-model action not found at ${selector}.`);

  const outPath = path.join(os.tmpdir(), `modelselect-v2-${process.pid}-${Date.now()}.out`);
  const env = { ...process.env, GITHUB_OUTPUT: outPath };
  const forwarded = {
    'task-type': 'TASK-TYPE',
    tier: 'TIER',
    'auto-preference': 'AUTO-PREFERENCE',
    'fallback-model': 'FALLBACK-MODEL',
    'max-cost': 'MAX-COST',
    'available-providers': 'AVAILABLE-PROVIDERS',
    'config-url': 'CONFIG-URL',
    'config-v2-url': 'CONFIG-V2-URL',
    'registry-url': 'REGISTRY-URL',
    'catalog-url': 'CATALOG-URL',
    'usage-url': 'USAGE-URL',
    'opencode-token': 'OPENCODE-TOKEN',
  };
  env['INPUT_TASK-TYPE'] = getInput('task-type') || 'auto';
  env['INPUT_TIER'] = getInput('tier') || 'auto';
  for (const [input, key] of Object.entries(forwarded)) {
    const value = getInput(input);
    if (value) env[`INPUT_${key}`] = value;
  }
  try {
    execFileSync(process.execPath, [selector], { env, stdio: 'inherit' });
  } catch (err) {
    fail(`select-model preselection failed: ${err?.message ?? err}`);
  }
  const outputs = {};
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      const at = line.indexOf('=');
      if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  if (!outputs.model) fail('select-model preselection returned no model.');
  let chain = [];
  try {
    chain = JSON.parse(outputs['model-chain'] || '[]');
  } catch {
    chain = [];
  }
  if (!Array.isArray(chain) || chain.length === 0) chain = [outputs.model];
  if (!chain.includes(outputs.model)) chain.unshift(outputs.model);
  return { model: outputs.model, chain };
}

/** Cheap access check against Zen; a 403 here is the "Model access is disabled" case. */
async function modelReachable(model, token) {
  if (!token) return true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: String(model).split('/').pop(),
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (res.ok) return true;
    if (res.status === 400) return true; // session-gated free routes still dispatch from OpenCode
    if (res.status === 403 || res.status === 404 || res.status === 401 || res.status === 402 || res.status === 429) return false;
    return true; // unknown status: fail open, the plugin still gets a chance at failover
  } catch {
    return true; // unreachable probe is not evidence of a disabled model
  } finally {
    clearTimeout(timer);
  }
}

async function resolvedModel() {
  const explicit = getInput('model');
  if (explicit) return explicit;
  const picked = preselectModel();
  if (!boolInput('probe-model-access')) return picked.model;
  const token = getInput('opencode-token') || process.env.OPENCODE_API_KEY || '';
  for (const candidate of picked.chain) {
    if (await modelReachable(candidate, token)) return candidate;
    warn(`Model '${candidate}' is not accessible with this token; trying the next chain candidate.`);
  }
  return picked.model; // no reachable candidate: keep the original so the error surfaces
}

/**
 * Merge our plugin entry into an opencode.json without dropping the user's
 * other settings. Existing plugin entries for the same package are replaced.
 * A file that is not valid JSON (e.g. JSONC with comments) is left untouched.
 */
function mergeConfig(file, pluginSource, options) {
  let config = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      warn(`Existing config ${file} is not plain JSON — leaving it untouched.`);
      return false;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  }
  const plugins = Array.isArray(config.plugins) ? config.plugins.slice() : [];
  const kept = plugins.filter(
    (p) => !(p && typeof p === 'object' && String(p.package ?? '') === pluginSource),
  );
  kept.push({ package: pluginSource, options });
  config.plugins = kept;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

function installOpenCode() {
  const bin = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  if (fs.existsSync(bin)) {
    notice(`OpenCode already installed at ${bin}`);
  } else {
    notice('Installing OpenCode…');
    try {
      execFileSync('bash', ['-c', 'curl -fsSL https://opencode.ai/install | bash'], {
        stdio: 'inherit',
      });
    } catch (err) {
      fail(`Could not install OpenCode: ${err?.message ?? err}`);
    }
  }
  const pathFile = process.env.GITHUB_PATH;
  if (pathFile) {
    fs.appendFileSync(pathFile, `${path.dirname(bin)}\n`, 'utf8');
  }
  return bin;
}

async function main() {
  const model = await resolvedModel();
  const options = pluginOptions();
  const pluginPackage = getInput('plugin-package');
  const bundled = path.resolve(__dirname, '..', '..', 'plugin');
  const pluginSource = pluginPackage || bundled;
  if (!pluginPackage && !fs.existsSync(path.join(bundled, 'index.js'))) {
    fail(`Bundled plugin not found at ${bundled}; pass 'plugin-package' explicitly.`);
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const globalConfig = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const projectConfig = path.join(workspace, '.opencode', 'opencode.json');
  const written = [
    mergeConfig(globalConfig, pluginSource, options),
    mergeConfig(projectConfig, pluginSource, options),
  ];
  if (!written.some(Boolean)) fail(`Could not write a plugin config (tried ${globalConfig} and ${projectConfig}).`);

  const bin = installOpenCode();
  const childEnv = {
    ...process.env,
    MODEL: model,
    AGENT: getInput('agent'),
    SHARE: getInput('share'),
    PROMPT: getInput('prompt'),
    USE_GITHUB_TOKEN: getInput('use_github_token', { fallback: 'false' }),
    MENTIONS: getInput('mentions'),
    VARIANT: getInput('variant'),
    OIDC_BASE_URL: getInput('oidc_base_url'),
  };
  const token = getInput('opencode-token');
  if (token) childEnv.OPENCODE_API_KEY = token;

  notice(`Running opencode github run with model '${model}' and modelselect plugin '${pluginSource}'.`);
  let exitCode = 0;
  try {
    execFileSync(bin, ['github', 'run'], { env: childEnv, cwd: workspace, stdio: 'inherit' });
  } catch (err) {
    exitCode = Number.isInteger(err?.status) ? err.status : 1;
    console.error(`::error::opencode github run failed (exit ${exitCode}).`);
  }

  writeOutputs({
    model,
    'plugin-config': written[0] ? globalConfig : projectConfig,
    'plugin-source': pluginSource,
  });
  process.exitCode = exitCode;
}

main().catch((err) => fail(`Unexpected error: ${err?.message ?? err}`));
