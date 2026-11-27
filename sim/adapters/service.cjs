'use strict';

/**
 * Service adapter: spawns the committed service bundle exactly as OpenChamber
 * does (loopback port + bearer token + throwaway HOME) and replays a list of
 * HTTP steps against it. Mirrors openchamber-modelselect/test/helpers/service.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { makeFixture, startService, globalConfigPath, extConfigPath } = require('../../openchamber-modelselect/test/helpers/service.cjs');

/**
 * Control events such as the router-switch toggle fire the routing sync
 * without awaiting it. Give those best-effort writes a bounded chance to land
 * before SIGTERM, so file expectations do not race the shutdown.
 */
async function waitForExpectedFiles(root, files, timeoutMs = 1000) {
  const wanted = Object.entries(files || {})
    .filter(([, spec]) => spec && spec.exists !== false)
    .map(([rel]) => path.join(root, rel));
  if (!wanted.length) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wanted.every((p) => fs.existsSync(p))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function run(scenario, ctx) {
  const fixture = makeFixture(scenario.fixture || {});
  const service = await startService(fixture);
  const http = [];
  try {
    for (const step of scenario.steps || []) {
      const query = { ...(step.query || {}) };
      if (query.directory === '{{project}}') query.directory = fixture.project;
      const body = JSON.parse(JSON.stringify(step.body || {}).replaceAll('{{project}}', fixture.project));
      const res = step.method === 'POST'
        ? await service.post(step.path, query, body, step.headers)
        : step.auth === false
          ? await fetch(new URL(step.path + '?' + new URLSearchParams(query), service.base).href)
          : await service.get(step.path, query);
      http.push({ path: step.path, method: step.method || 'GET', status: res.status, body: res.body !== undefined ? res.body : await res.json().catch(() => null) });
    }
  } finally {
    await waitForExpectedFiles(fixture.root, scenario.expect && scenario.expect.files);
    service.stop();
  }
  return {
    exit: 0,
    stdout: '',
    stderr: '',
    http,
    fsRoot: fixture.root,
    calls: [],
    pluginConfig: fs.existsSync(globalConfigPath(fixture)) ? fs.readFileSync(globalConfigPath(fixture), 'utf8') : '',
    extConfig: fs.existsSync(extConfigPath(fixture)) ? fs.readFileSync(extConfigPath(fixture), 'utf8') : '',
  };
}

function verify(scenario, result) {
  const failures = [];
  const e = scenario.expect || {};
  for (let i = 0; i < (e.http || []).length; i += 1) {
    const want = e.http[i];
    const got = result.http[i];
    if (!got) { failures.push(`step ${i}: no response`); continue; }
    if (want.status !== undefined && got.status !== want.status) failures.push(`step ${i} ${got.path}: status ${got.status} != ${want.status}`);
    if (want.jsonContains && !deepPartial(got.body, want.jsonContains)) failures.push(`step ${i} ${got.path}: body does not contain ${JSON.stringify(want.jsonContains)}`);
  }
  if (e.pluginConfigContains && !result.pluginConfig.includes(e.pluginConfigContains)) failures.push(`global config missing ${JSON.stringify(e.pluginConfigContains)}`);
  if (e.extConfigContains && !result.extConfig.includes(e.extConfigContains)) failures.push(`ext config missing ${JSON.stringify(e.extConfigContains)}`);
  return failures;
}

function deepPartial(hay, needle) {
  if (Array.isArray(needle)) return needle.every((n) => hay?.some?.((h) => deepPartial(h, n)));
  if (needle && typeof needle === 'object') {
    if (!hay || typeof hay !== 'object') return false;
    return Object.entries(needle).every(([k, v]) => deepPartial(hay[k], v));
  }
  return Object.is(hay, needle);
}

module.exports = { run, verify };
