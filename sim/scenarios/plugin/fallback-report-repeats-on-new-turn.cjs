'use strict';

const now = Date.now();
const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };
const REPORT = 'no usable model — checked 1: opencode/free-a (over maxCost $0.2); using opencode/cheap-fallback';

module.exports = {
  id: 'plugin/fallback-report-repeats-on-new-turn',
  component: 'plugin',
  title: 'a new prompt can report the same fallback exclusions again',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: now,
        config: {
          'task-types': {
            code: {
              go: 'opencode-go/paid-a',
              free: 'opencode/free-b',
              ranked: [
                { model: 'opencode/free-a', score: 95, blended_cost: 1 },
                { model: 'opencode/free-b', score: 90, blended_cost: 1 },
              ],
              free_ranked: [
                { model: 'opencode/free-a', score: 95, blended_cost: 1 },
                { model: 'opencode/free-b', score: 90, blended_cost: 1 },
              ],
              go_ranked: [{ model: 'opencode-go/paid-a', score: 80, blended_cost: 1 }],
            },
          },
        },
      },
      '.opencode/.modelselect-cache/provider-catalog-cache.json': {
        fetchedAt: now,
        catalog: {
          models: [
            { provider: 'opencode', id: 'free-a', canonical: 'free-a', blended_cost: 1, context: 200000 },
            { provider: 'opencode', id: 'free-b', canonical: 'free-b', context: 200000 },
          ],
        },
      },
    },
  },
  options: { tier: 'free', taskType: 'code', announce: 'off', maxCost: 0.2, fallbackModel: 'opencode/cheap-fallback' },
  steps: [
    { hook: 'context', with: { sessionID: 's2', agent: 'code', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's2', prompt: 'first turn' } },
    { hook: 'prompt', with: { sessionID: 's2', prompt: 'second turn' } },
  ],
  expect: {
    plugin: {
      promptTextContains: REPORT,
      promptTextNot: 'task=code tier=',
    },
  },
};
