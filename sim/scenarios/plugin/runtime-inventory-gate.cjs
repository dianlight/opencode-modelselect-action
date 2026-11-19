'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };
const now = Date.now();

module.exports = {
  id: 'plugin/runtime-inventory-gate',
  component: 'plugin',
  title: 'a catalog variant absent from the runtime inventory is skipped for the next chain candidate',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: now,
        config: { 'task-types': { code: { go: 'opencode-go/qwen3.8-flash', free: 'opencode/hy4-flash-free' } } },
      },
      '.opencode/.modelselect-cache/model-config-v2-cache.json': {
        fetchedAt: now,
        config: { schema_version: 2, 'task-types-v2': { code: { model: 'qwen3-8-flash', score: 86, think: 'medium' } } },
      },
      '.opencode/.modelselect-cache/model-registry-v2-cache.json': {
        fetchedAt: now,
        registry: {
          schema_version: 2,
          models: {
            'qwen3-8-flash': {
              id: 'qwen3-8-flash',
              name: 'Qwen3.8 Flash',
              score: 86,
              variants: [
                { provider: 'opencode', model: 'qwen3.8-flash', free: false, cost: 0.23 },
                { provider: 'opencode-go', model: 'qwen3.8-flash', free: false, cost: 0.23 },
              ],
            },
          },
        },
      },
      // Only the Go variant is actually served: `opencode/qwen3.8-flash`
      // would fail with ModelNotFoundError before any provider request.
      '.opencode/.modelselect-cache/runtime-inventory.json': {
        fetchedAt: now,
        models: [
          { providerID: 'opencode', id: 'hy4-flash-free', enabled: true },
          { providerID: 'opencode-go', id: 'qwen3.8-flash', enabled: true },
        ],
      },
    },
  },
  options: { tier: 'go', taskType: 'code', verbose: true },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'code', model: VIRTUAL, messages: [] } },
    { hook: 'http.request', with: { sessionID: 's1', model: VIRTUAL, requestBody: '' } },
  ],
  expect: {
    plugin: {
      headers: { 'x-modelselect-provider': 'opencode-go', 'x-modelselect-model': 'qwen3.8-flash' },
      noSwitch: true,
    },
  },
};
