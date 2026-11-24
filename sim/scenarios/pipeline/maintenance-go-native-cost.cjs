'use strict';

module.exports = {
  id: 'pipeline/maintenance-go-native-cost',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'maintenance prices a Go model from its native cost when the docs table has no row',
  net: [
    { match: 'zen/v1/models', body: { data: [] } },
    {
      match: 'zen/go/v1/models',
      body: {
        data: [{
          id: 'go-native',
          endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
          cost: { text: { input: { price: 1.5 }, output: { price: 4.0 } } },
          limit: { context: 1000000, output: 128000 },
          go: { monthly_usage: { go: 60, 'go-plus': 240, 'go-teams': 65 } },
        }],
      },
    },
    { match: 'docs/it/zen', fail: true },
    { match: 'docs/go', fail: true },
    { match: 'models.dev', fail: true },
    { match: 'LiveBench/LiveBench/main/changelog.md', body: '### 2026-01-15\n' },
    { match: 'livebench.ai/table_', body: 'model,code_completion\ngo-native,90.0\n' },
    { match: 'livebench.ai/', fail: true },
    { match: 'api.github.com', fail: true },
    { match: 'raw.githubusercontent.com', fail: true },
  ],
  world: {
    files: {
      'pipeline/config/task-types.yaml': { copy: 'task-types-minimal.yaml' },
      'pipeline/config/providers.yaml': { copy: 'providers-minimal.yaml' },
      'pipeline/config/model-scores.yaml': { copy: 'model-scores-empty.yaml' },
      'pipeline/config/model-capabilities.yaml': { copy: 'model-capabilities-minimal.yaml' },
      'pipeline/data/zen_models.json': { all: [] },
      'pipeline/data/go_models.json': [],
      'pipeline/data/livebench.json': { models: {} },
    },
  },
  expectFiles: ['data/model-config.json', 'data/model-registry-v2.json'],
  expect: {
    driverExit: 0,
    files: {
      'pipeline/data/model-config.json': {
        contains: '"blended_cost": 2.125',
        notContains: '"output": null',
      },
      'pipeline/data/model-registry-v2.json': {
        contains: '"go-teams": 65',
        notContains: '"cost": null',
      },
    },
  },
};
