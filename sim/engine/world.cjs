'use strict';

/**
 * Sandbox world per scenario: a temp root holding every file the component
 * under test may read or write, plus its environment. Nothing escapes into
 * the repo or the developer's home directory.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/**
 * `files` maps a repo-relative path to either raw text, a JSON value (written
 * pretty-printed), or `{ copy: '<fixture file under sim/fixtures>' }`.
 */
function writeFiles(root, files) {
  for (const [rel, value] of Object.entries(files || {})) {
    let content = value;
    if (value && typeof value === 'object' && !Array.isArray(value) && value.copy !== undefined) {
      content = fs.readFileSync(path.join(FIXTURES, value.copy), 'utf8');
    } else if (typeof content !== 'string') {
      content = JSON.stringify(content, null, 2);
    }
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function createWorld(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-'));
  writeFiles(root, scenario.world?.files);
  const env = { ...process.env };
  // A dev machine's real key would turn "no token" cases into live network calls.
  delete env.OPENCODE_API_KEY;
  delete env.OPENCODE_AUTH_JSON;
  Object.assign(env, scenario.env || {});
  return {
    root,
    env,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { createWorld, writeFiles, FIXTURES };
