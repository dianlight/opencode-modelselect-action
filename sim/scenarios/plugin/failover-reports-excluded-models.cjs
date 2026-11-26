'use strict';

const now = Date.now();

module.exports = {
  id: 'plugin/failover-reports-excluded-models',
  component: 'plugin',
  title: 'a runtime 429 reports the excluded chain candidate in chat before the failover',
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
  options: { tier: 'free', taskType: 'review', announce: 'off' },
  steps: [
    {
      hook: 'http.response',
      with: {
        kind: 'primary',
        sessionID: 'runtime-1',
        model: { providerID: 'opencode', id: 'free-a' },
        response: { status: 429 },
      },
    },
    {
      hook: 'retry',
      with: {
        sessionID: 'runtime-1',
        model: { providerID: 'opencode', id: 'free-a' },
        error: { type: 'rate_limit', message: '429 too many requests', status: 429 },
        attempt: 2,
        decision: { retry: false },
      },
    },
  ],
  expect: {
    plugin: {
      decisionRetry: true,
      switchedCount: 1,
      syntheticContains: 'chain failover — excluded 1: opencode/free-a (rate-limited); using ',
    },
  },
};
