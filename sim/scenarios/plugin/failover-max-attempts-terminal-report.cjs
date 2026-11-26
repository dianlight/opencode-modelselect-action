'use strict';

const now = Date.now();
const models = Array.from({ length: 13 }, (_, i) => ({ providerID: 'opencode-go', id: `m${i}` }));
const chain = models.map((m, i) => ({
  model: `${m.providerID}/${m.id}`,
  score: 100 - i,
  blended_cost: 0.5,
}));
const catalogModels = models.map((m) => ({
  provider: m.providerID,
  id: m.id,
  canonical: m.id,
  blended_cost: 0.5,
  context: 200000,
}));
const steps = models.flatMap((model) => [
  {
    hook: 'http.response',
    with: { kind: 'primary', sessionID: 's1', model, response: { status: 402 } },
  },
  {
    hook: 'retry',
    with: { sessionID: 's1', model, decision: { retry: false } },
  },
]);
const shown = models.slice(0, 6).map((m) => `${m.providerID}/${m.id} (paid-limit)`).join(', ');

module.exports = {
  id: 'plugin/failover-max-attempts-terminal-report',
  component: 'plugin',
  title: 'the failover attempt cap reports every rejected candidate instead of stopping silently',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: now,
        config: {
          'task-types': {
            review: {
              go: `${models[0].providerID}/${models[0].id}`,
              free: 'opencode/free-a',
              ranked: chain,
              go_ranked: chain,
            },
          },
        },
      },
      '.opencode/.modelselect-cache/provider-catalog-cache.json': {
        fetchedAt: now,
        catalog: { providers: { 'opencode-go': {}, opencode: {} }, models: catalogModels },
      },
    },
  },
  options: { tier: 'go', taskType: 'review', announce: 'off' },
  steps,
  expect: {
    plugin: {
      switchedCount: 12,
      syntheticContains: `[modelselect] chain failover — excluded 13: ${shown}, +7 more; no candidate left`,
    },
  },
};
