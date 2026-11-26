'use strict';

/**
 * v2 action adapter: runs the combined opencode + modelselect action in a
 * sandboxed HOME with a stub `opencode` binary, so no network or real CLI is
 * involved. The action still writes real opencode.json files under the sandbox.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ACTION = path.join(__dirname, '..', '..', 'github-action-v2', 'src', 'index.js');

function run(scenario, ctx) {
  const { root } = ctx.world;
  const home = path.join(root, 'home');
  const binDir = path.join(home, '.opencode', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'opencode');
  const argsFile = path.join(root, 'opencode-args.txt');
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'opencode 2.3.0'; exit 0; fi\nprintf '%s\\n' "$@" > "$OPENCODE_ARGS_FILE"\nexit ${scenario.opencodeExit ?? 0}\n`, { mode: 0o755 });

  const outPath = path.join(root, 'github-output.txt');
  const env = { ...ctx.world.env, HOME: home, OPENCODE_ARGS_FILE: argsFile };
  env.GITHUB_OUTPUT = outPath;
  env.GITHUB_WORKSPACE = root;

  return new Promise((resolve) => {
    execFile('node', [ACTION], { env, cwd: root }, (err, stdout, stderr) => {
      const outputs = {};
      if (fs.existsSync(outPath)) {
        for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
          const i = line.indexOf('=');
          if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
        }
      }
      resolve({
        exit: err ? (err.code ?? 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        outputs,
        calls: [],
        fsRoot: root,
      });
    });
  });
}

module.exports = { run };
