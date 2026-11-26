'use strict';

module.exports = {
  id: 'action/fallback-exclusions-warning',
  component: 'action',
  title: 'an empty chain warns with every rejected candidate and its exact gate',
  world: {
    files: {
      'model-config.json': {
        'task-types': {
          'pr-review': {
            go: 'opencode-go/paid-b',
            free: 'opencode/free-a',
            ranked: [{ model: 'opencode-go/paid-b', score: 95, blended_cost: 1 }],
            go_ranked: [{ model: 'opencode-go/paid-b', score: 95, blended_cost: 1 }],
            free_ranked: [{ model: 'opencode/free-a', score: 90, blended_cost: 0 }],
          },
        },
      },
      'model-config-v2.json': {},
      'provider-catalog.json': {
        providers: { opencode: {}, 'opencode-go': {} },
        models: [
          { provider: 'opencode', id: 'free-a', canonical: 'free-a', blended_cost: 0, context: 200000 },
          { provider: 'opencode-go', id: 'paid-b', canonical: 'paid-b', blended_cost: 1, context: 1000000 },
        ],
      },
    },
  },
  env: {
    'INPUT_TASK-TYPE': 'pr-review',
    'INPUT_TIER': 'go',
    'INPUT_AVAILABLE-PROVIDERS': 'opencode',
    'INPUT_CONFIG-PATH': '{{root}}/model-config.json',
    'INPUT_CONFIG-URL': '',
    'INPUT_CONFIG-V2-PATH': '{{root}}/model-config-v2.json',
    'INPUT_CONFIG-V2-URL': '',
    'INPUT_CATALOG-PATH': '{{root}}/provider-catalog.json',
    'INPUT_CATALOG-URL': '',
    'INPUT_REGISTRY-PATH': '',
    'INPUT_REGISTRY-URL': '',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode-go/paid-b' },
    stdout: /no usable model — checked 1: opencode-go\/paid-b \(provider not allowed\)/,
  },
};
