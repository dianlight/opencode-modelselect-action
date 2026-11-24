'use strict';

const now = Date.now();

module.exports = {
  id: 'plugin/explicit-model-failover',
  component: 'plugin',
  title: 'a rejected explicit model switches the session to the next chain candidate',
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
                { model: 'opencode/free-a', score: 95 },
                { model: 'opencode-go/paid-a', score: 90 },
                { model: 'opencode/free-b-free', score: 85 },
              ],
            },
          },
        },
      },
      '.opencode/.modelselect-cache/provider-catalog-cache.json': {
        fetchedAt: now,
        catalog: {
          models: [
            { provider: 'opencode', id: 'free-a', canonical: 'free-a', blended_cost: 0, context: 200000 },
            { provider: 'opencode-go', id: 'paid-a', canonical: 'paid-a', blended_cost: 0.1, context: 200000 },
            { provider: 'opencode', id: 'free-b-free', canonical: 'free-b', blended_cost: 0, context: 200000 },
          ],
        },
      },
    },
  },
  options: { tier: 'free', taskType: 'review', verbose: true },
  steps: [
    {
      hook: 'http.response',
      with: {
        kind: 'primary',
        sessionID: 'explicit-1',
        model: { providerID: 'opencode', id: 'free-a' },
        response: { status: 429 },
      },
    },
    {
      hook: 'retry',
      with: {
        sessionID: 'explicit-1',
        model: { providerID: 'opencode', id: 'free-a' },
        error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
        attempt: 2,
        decision: { retry: false },
      },
    },
  ],
  expect: {
    plugin: { decisionRetry: true, switchedCount: 1 },
  },
};
