'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-go-first' };
const now = Date.now();

module.exports = {
  id: 'plugin/paid-limit-latch-prevents-retry',
  component: 'plugin',
  title: 'a paid-side limit latches the ref so the next prompt skips it instead of replaying the cascade',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: now,
        config: {
          'task-types': {
            review: {
              go: 'opencode-go/paid-a',
              free: 'opencode/free-a',
              ranked: [
                { model: 'opencode-go/paid-a', score: 95 },
                { model: 'opencode/free-a', score: 85 },
              ],
            },
          },
        },
      },
      '.opencode/.modelselect-cache/model-config-v2-cache.json': {
        fetchedAt: now,
        config: { schema_version: 2, 'task-types-v2': {} },
      },
      '.opencode/.modelselect-cache/provider-catalog-cache.json': {
        fetchedAt: now,
        catalog: {
          models: [
            { provider: 'opencode-go', id: 'paid-a', blended_cost: 0.1, context: 200000 },
            { provider: 'opencode', id: 'free-a', blended_cost: 0, context: 200000 },
          ],
        },
      },
      '.opencode/.modelselect-cache/runtime-inventory.json': {
        fetchedAt: now,
        models: [
          { providerID: 'opencode-go', id: 'paid-a', enabled: true },
          { providerID: 'opencode', id: 'free-a', enabled: true },
        ],
      },
    },
  },
  options: { tier: 'auto', taskType: 'review', autoPreference: 'go-first', announce: 'off' },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    {
      hook: 'retry',
      with: {
        sessionID: 's1',
        model: { providerID: 'opencode-go', id: 'paid-a' },
        error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
        attempt: 2,
        decision: { retry: false },
      },
    },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'generate a commit message' } },
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    {
      hook: 'http.request',
      with: {
        sessionID: 's1',
        model: VIRTUAL,
        requestBody: JSON.stringify({ model: VIRTUAL.id, messages: [] }),
      },
    },
  ],
  expect: {
    plugin: {
      decisionRetry: true,
      headers: { 'x-modelselect-model': 'free-a' },
      noSwitch: true,
    },
  },
};
