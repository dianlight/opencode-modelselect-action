'use strict';

/**
 * GitHub Action adapter: spawns the real action entrypoint in a sandbox
 * with INPUT_* env, GITHUB_OUTPUT/GITHUB_ENV files and a mock net for the
 * usage/probe/config endpoints.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ACTION = path.join(__dirname, '..', '..', 'github-action', 'src', 'index.js');

function run(scenario, ctx) {
  const outPath = path.join(ctx.world.root, 'github-output.txt');
  const envPath = path.join(ctx.world.root, 'github-env.txt');
  const env = { ...ctx.world.env };
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') env[k] = v.split('{{root}}').join(ctx.world.root).split('{{net}}').join(ctx.net ? ctx.net.origin : '');
  }
  env.GITHUB_OUTPUT = outPath;
  env.GITHUB_ENV = envPath;
  env.GITHUB_WORKSPACE = ctx.world.root;
  return new Promise((resolve) => {
    execFile('node', [ACTION], { env, cwd: ctx.world.root }, (err, stdout, stderr) => {
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
        calls: ctx.net ? ctx.net.calls : [],
        fsRoot: ctx.world.root,
      });
    });
  });
}

module.exports = { run };
