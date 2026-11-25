'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };
const now = Date.now();

module.exports = {
  id: 'plugin/fallback-reports-excluded-models',
  component: 'plugin',
  title: 'an empty chain reports every checked model and why it was rejected, even with announce=off',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: now,
        config: {
          'task-types': {
            code: {
              go: 'g/a',
              free: 'f/b',
              go_ranked: [{ model: 'g/a', score: 10, blended_cost: 0.2 }],
              free_ranked: [{ model: 'f/b', score: 10, blended_cost: 0 }],
            },
          },
        },
      },
      '.opencode/.modelselect-cache/model-config-v2-cache.json': {
        fetchedAt: now,
        config: {
          schema_version: 2,
          'task-types-v2': {
            code: { model: 'gemini-4-argon', models: ['gemini-4-argon', 'flint-40b'], score: 80 },
          },
        },
      },
      '.opencode/.modelselect-cache/model-registry-v2-cache.json': {
        fetchedAt: now,
        registry: {
          schema_version: 2,
          models: {
            'gemini-4-argon': {
              id: 'gemini-4-argon',
              variants: [
                { provider: 'opencode', model: 'gemini-4-argon', free: false, cost: 4 },
                { provider: 'opencode-go', model: 'gemini-4-argon', free: false, cost: 4 },
              ],
            },
            'flint-40b': {
              id: 'flint-40b',
              variants: [
                { provider: 'opencode', model: 'flint-40b-free', free: true, cost: 0 },
              ],
            },
          },
        },
      },
      '.opencode/.modelselect-cache/provider-catalog-cache.json': {
        fetchedAt: now,
        catalog: { models: [] },
      },
      '.opencode/.modelselect-cache/free-quota.json': {
        version: 2,
        models: {
          'opencode/flint-40b-free': {
            at: now,
            until: now + 3600000,
            kind: 'rate-limit',
            detail: 'http 429',
            updatedAt: now,
          },
        },
      },
    },
  },
  options: { tier: 'auto', taskType: 'code', announce: 'off', maxCost: 0.16 },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'code', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'fix this bug' } },
  ],
  expect: {
    plugin: {
      promptTextContains: 'no usable model — checked 3',
      promptTextNot: 'task=code tier=',
      noSwitch: true,
    },
  },
};
