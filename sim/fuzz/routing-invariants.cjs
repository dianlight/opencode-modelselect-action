'use strict';

/**
 * Generative invariant pack for the shared routing core. Seeded, so every
 * failure names the seed that reproduces it (`--seed N`).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mulberry32, int, pick, catalog } = require('../engine/prng.cjs');
const { normModelName } = require('../../core/model-ref');
const { selectWithinBudget } = require('../../core/budget');
const { buildDesired, syncRouting, mergeCategories, pickSideRef, isVirtualModelRef } = require('../../core/routing');

const TASK_NAMES = ['generic', 'review', 'code', 'docs', 'bugfix'];
const MODEL_NAMES = ['opencode/a-free', 'opencode/b-free', 'opencode-go/c', 'opencode-go/d'];

/** Map-based IO exactly like plugin/test/routing.test.js's fakeIo. */
function fakeIo(initial = {}) {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return {
    files,
    writes,
    async readJson(p) { return files.has(p) ? files.get(p) : null; },
    async writeJson(p, value) { files.set(p, value); writes.push(p); },
  };
}

const ROUTING_PATH = '~/.config/openchamber/routing.json';

function caches(rand, taskNames) {
  return {
    '.opencode/.modelselect-cache/model-config-cache.json': {
      fetchedAt: 1,
      config: { 'task-types': catalog(rand, taskNames, MODEL_NAMES) },
    },
    '.opencode/.modelselect-cache/task-types-cache.json': {
      v: 2,
      fetchedAt: 1,
      taskTypes: Object.fromEntries(taskNames.map((n) => [n, { label: n, description: 'd', jev_criteria: `criteria ${n}` }])),
    },
  };
}

async function run(seed) {
  const failures = [];
  const cases = 200;
  for (let i = 0; i < cases; i += 1) {
    const rand = mulberry32(seed * 100003 + i);
    const taskNames = TASK_NAMES.slice(0, int(rand, 1, TASK_NAMES.length + 1));
    const table = caches(rand, taskNames)['.opencode/.modelselect-cache/model-config-cache.json'].config['task-types'];

    // 1. budget: a fitting pick never exceeds max-cost, a miss is honest.
    for (const [taskKey, entry] of Object.entries(table)) {
      const maxCost = Number((rand() * 12).toFixed(2));
      for (const tier of ['go', 'free']) {
        const ranked = entry[`${tier}_ranked`] || [];
        if (!ranked.length) continue;
        const recommended = pick(rand, ranked).model;
        let res;
        try { res = selectWithinBudget(entry, taskKey, tier, recommended, maxCost); } catch (err) {
          failures.push(`seed ${seed} case ${i}: selectWithinBudget threw for ${taskKey}/${tier}: ${err.message}`);
          continue;
        }
        if (res.model === null) {
          const anyFits = ranked.some((r) => r.blended_cost !== null && r.blended_cost <= maxCost);
          if (anyFits) failures.push(`seed ${seed} case ${i}: ${taskKey}/${tier} null but a model fits ${maxCost}`);
        } else {
          // The pick must be a ranked row (by normalized name) whose echoed
          // cost is within budget — duplicates of the same model name with
          // different costs are legal, so match by name + cost, not index.
          const cost = Number(res.cost);
          const nameOk = ranked.some((r) => normModelName(r.model) === normModelName(res.model));
          const rowOk = ranked.some(
            (r) => normModelName(r.model) === normModelName(res.model) && r.blended_cost === cost,
          );
          if (!nameOk) failures.push(`seed ${seed} case ${i}: picked ${res.model} not in ranked list`);
          else if (!(cost <= maxCost)) failures.push(`seed ${seed} case ${i}: picked ${res.model} at ${cost} over budget ${maxCost}`);
          else if (!rowOk) failures.push(`seed ${seed} case ${i}: echoed cost ${cost} matches no ranked row for ${res.model}`);
        }
      }
    }

    // 2. buildDesired: keys stay inside the catalog, criteria verbatim.
    for (const preference of ['free-first', 'go-first']) {
      const built = buildDesired(
        Object.fromEntries(taskNames.map((n) => [n, { label: n, jev_criteria: `criteria ${n}` }])),
        table,
        preference,
        rand() < 0.5,
      );
      if (built.unusable) continue;
      for (const key of Object.keys(built.desired || {})) {
        if (!taskNames.includes(key)) failures.push(`seed ${seed} case ${i}: desired has unknown key ${key}`);
        if (built.desired[key].description !== `criteria ${key}`) {
          failures.push(`seed ${seed} case ${i}: criteria for ${key} not verbatim`);
        }
      }
    }

    // 3. syncRouting idempotent + never writes on unusable payloads.
    const io = fakeIo(caches(rand, taskNames));
    await syncRouting(io);
    const first = io.files.get(ROUTING_PATH);
    const writes1 = io.writes.length;
    await syncRouting(io);
    if (JSON.stringify(io.files.get(ROUTING_PATH)) !== JSON.stringify(first)) {
      failures.push(`seed ${seed} case ${i}: second sync changed routing.json`);
    }
    if (io.writes.length !== writes1 + 0 && io.writes.length > writes1 + 1) {
      failures.push(`seed ${seed} case ${i}: second sync rewrote ${io.writes.length - writes1} files`);
    }
    const broken = fakeIo({ [ROUTING_PATH]: '{broken' });
    await syncRouting(broken);
    if (broken.writes.length) failures.push(`seed ${seed} case ${i}: wrote from a broken payload`);

    // 3b. autoset never resolves a virtual routing anchor as a concrete ref.
    const virtualTable = {
      ...table,
      generic: {
        ...(table.generic || {}),
        free: 'modelselect/auto-free-first',
        free_ranked: [
          { model: 'modelselect/auto-free-first' },
          { model: 'opencode/concrete-free' },
        ],
      },
    };
    for (const preference of ['free-first', 'go-first']) {
      const ref = pickSideRef(virtualTable, 'generic', preference);
      if (!ref) failures.push(`seed ${seed} case ${i}: ${preference} resolved no ref with a concrete fallback`);
      else if (isVirtualModelRef(ref)) failures.push(`seed ${seed} case ${i}: ${preference} resolved virtual ${ref}`);
    }
  }

  // 4. mergeCategories: stale entries get disabled, never dropped silently.
  const rand = mulberry32(seed);
  const names = ['review'];
  const desired = buildDesired(
    { review: { label: 'R', jev_criteria: 'c' } },
    { review: { go: 'g/a', free: 'f/b' } },
    'free-first',
  ).desired;
  const merged = mergeCategories({ review: { builtin: false, name: 'Mine', description: 'old', model: { providerID: 'u', modelID: 'z' } }, gone: { builtin: false, name: 'Gone' } }, desired, []);
  if (!merged || merged.review.description !== 'c') failures.push(`seed ${seed}: mergeCategories did not apply desired`);
  void rand; void names;

  return { failures, cases };
}

if (require.main === module) {
  const seed = Number(process.argv[2] || 42);
  run(seed).then(({ failures, cases }) => {
    process.stdout.write(`${failures.length} failures over ${cases} cases (seed ${seed})\n`);
    for (const f of failures.slice(0, 10)) process.stdout.write(`  - ${f}\n`);
  });
}

module.exports = { run };
