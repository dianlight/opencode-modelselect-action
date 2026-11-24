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

const VIRTUAL_PROVIDER = 'modelselect';
const VIRTUAL_FREE = 'auto-free-first';
const VIRTUAL_GO = 'auto-go-first';

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

/** Virtual anchor when the caller leaves `model` empty. */
function anchorModel() {
  const explicit = getInput('model');
  if (explicit) return explicit;
  const tier = (getInput('tier', { fallback: 'auto' }) || 'auto').toLowerCase();
  const preference = (getInput('auto-preference', { fallback: 'free-first' }) || 'free-first').toLowerCase();
  if (!['go', 'free', 'auto'].includes(tier)) fail(`Input 'tier' must be go, free or auto, got '${tier}'.`);
  if (!['free-first', 'go-first'].includes(preference)) {
    fail(`Input 'auto-preference' must be free-first or go-first, got '${preference}'.`);
  }
  const go = tier === 'go' || (tier === 'auto' && preference === 'go-first');
  return `${VIRTUAL_PROVIDER}/${go ? VIRTUAL_GO : VIRTUAL_FREE}`;
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

function main() {
  const model = anchorModel();
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

main();
