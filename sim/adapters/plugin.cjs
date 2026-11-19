'use strict';

/**
 * Plugin adapter: boots the real plugin module in a child process against a
 * fake OpenCode v2 host (hook registry, switchModel, synthetic, prompt),
 * with the scenario's cache seeds and options. The child prints one JSON
 * line; the adapter shapes it into a result.
 */

const { execFile } = require('node:child_process');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', 'engine', 'plugin-runner.cjs');

function run(scenario, ctx) {
  const file = scenario.__file;
  return new Promise((resolve) => {
    execFile('node', [RUNNER, file], { cwd: ctx.world.root }, (err, stdout, stderr) => {
      let payload = {};
      const line = String(stdout || '').split('\n').find((l) => l.startsWith('SIMRESULT'));
      if (line) {
        try { payload = JSON.parse(line.slice('SIMRESULT'.length)); } catch { payload = {}; }
      }
      resolve({
        exit: err ? (err.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        seen: payload.seen || {},
        error: payload.error || null,
        calls: ctx.net ? ctx.net.calls : [],
        fsRoot: ctx.world.root,
      });
    });
  });
}

function verify(scenario, result) {
  const failures = [];
  const e = scenario.expect?.plugin || {};
  const seen = result.seen || {};
  if (e.noSwitch && seen.switched !== undefined) {
    failures.push(`switchModel should not fire, got ${JSON.stringify(seen.switched)}`);
  }
  if (e.promptTextContains && !(result.seen.promptText || '').includes(e.promptTextContains)) {
    failures.push(`prompt text ${JSON.stringify(result.seen.promptText)} missing ${JSON.stringify(e.promptTextContains)}`);
  }
  if (e.promptTextEquals !== undefined && result.seen.promptText !== e.promptTextEquals) {
    failures.push(`prompt text ${JSON.stringify(result.seen.promptText)} != ${JSON.stringify(e.promptTextEquals)}`);
  }
  if (e.promptTextNot && (result.seen.promptText || '').includes(e.promptTextNot)) {
    failures.push(`prompt text should not contain ${JSON.stringify(e.promptTextNot)}`);
  }
  if (e.contextModel && JSON.stringify(result.seen.contextModel) !== JSON.stringify(e.contextModel)) {
    failures.push(`context event model mutated: ${JSON.stringify(result.seen.contextModel)} != ${JSON.stringify(e.contextModel)}`);
  }
  for (const [k, v] of Object.entries(e.headers || {})) {
    if (!String(result.seen.headers?.[k] || '').includes(v)) failures.push(`header ${k}=${JSON.stringify(result.seen.headers?.[k])} does not include ${v}`);
  }
  if (e.switchedCount !== undefined && (seen.switches || []).length !== e.switchedCount) {
    failures.push(`switchModel called ${(seen.switches || []).length} times, expected ${e.switchedCount}`);
  }
  if (e.syntheticContains && !JSON.stringify(seen.synthetics || []).includes(e.syntheticContains)) {
    failures.push(`no synthetic output contains ${JSON.stringify(e.syntheticContains)}`);
  }
  if (e.addedIncludes && !(seen.added || []).includes(e.addedIncludes)) {
    failures.push(`provider registration missing ${e.addedIncludes} (added: ${JSON.stringify(seen.added)})`);
  }
  if (e.catalogHas && !(seen.catalog || []).includes(e.catalogHas)) {
    failures.push(`catalog missing provider ${e.catalogHas}`);
  }
  if (e.virtualCount !== undefined && (seen.virtualModels || []).length !== e.virtualCount) {
    failures.push(`virtual models ${(seen.virtualModels || []).length} != ${e.virtualCount}`);
  }
  if (e.promptsMin !== undefined && (seen.promptsOut || []).length < e.promptsMin) {
    failures.push(`prompt hooks fired ${(seen.promptsOut || []).length} < ${e.promptsMin}`);
  }
  const retried = (seen.decisions || []).some((d) => d && d.retry === true);
  if (e.decisionRetry !== undefined && retried !== e.decisionRetry) {
    failures.push(`retry decision ${retried} != ${e.decisionRetry} (decisions: ${JSON.stringify(seen.decisions)})`);
  }
  if (e.catalogMissRef && !String(seen.catalogMiss || '').includes(e.catalogMissRef)) {
    failures.push(`catalog-miss.json missing ${e.catalogMissRef}`);
  }
  return failures;
}

module.exports = { run, verify };
