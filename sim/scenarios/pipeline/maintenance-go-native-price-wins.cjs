'use strict';

module.exports = {
  id: 'pipeline/maintenance-go-native-price-wins',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'maintenance prefers the native Go API price over a stale docs cell and keeps monthly limits',
  net: [
    { match: 'zen/v1/models', body: { data: [] } },
    {
      match: 'zen/go/v1/models',
      body: {
        data: [{
          id: 'go-priced',
          cost: {
            text: { input: { price: 2 }, output: { price: 10 }, cache: { read: 0.1 } },
            multipliers: [{ when: { date: { gte: '2026-12-01' } }, factor: 2 }],
          },
          limit: { context: 1000000, output: 128000 },
          go: { monthly_usage: { go: 30, 'go-plus': 120, 'go-teams': 35 } },
        }],
      },
    },
    {
      // The docs page shows both the old and the discounted price in one
      // cell. Reading the first value used to win over the API's current rate.
      match: 'docs/it/zen',
      body:
        '<table><tr><th>Model</th><th>Model ID</th><th>Endpoint</th></tr>' +
        '<tr><td>Go Priced</td><td>go-priced</td>' +
        '<td>https://opencode.ai/inference/go/openai/v1/chat/completions</td></tr></table>' +
        '<table><tr><th>Model</th><th>Input</th><th>Output</th></tr>' +
        '<tr><td>Go Priced</td><td>$4.00 $2.00</td><td>$20.00 $10.00</td></tr></table>',
    },
    {
      match: 'docs/go',
      body:
        '<table><tr><th>Model</th><th>Model ID</th></tr>' +
        '<tr><td>Go Priced</td><td>go-priced</td></tr></table>' +
        '<table><tr><th>Model</th><th>Input</th><th>Output</th><th>Usage</th></tr>' +
        '<tr><td>Go Priced</td><td>$4.00 $2.00</td><td>$20.00 $10.00</td><td>$30</td></tr></table>',
    },
    { match: 'models.dev', fail: true },
    { match: 'LiveBench/LiveBench/main/changelog.md', body: '### 2026-01-15\n' },
    { match: 'livebench.ai/table_', body: 'model,code_completion\ngo-priced,90.0\n' },
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
  expectFiles: [
    'data/go_models.json',
    'data/model-config.json',
    'data/model-registry-v2.json',
  ],
  expect: {
    driverExit: 0,
    files: {
      'pipeline/data/go_models.json': {
        contains: '"source": "native-cost"',
        notContains: '"input": "$4.00 $2.00"',
      },
      'pipeline/data/model-config.json': {
        contains: '"blended_cost": 4.0',
        notContains: '"blended_cost": 8.0',
      },
      'pipeline/data/model-registry-v2.json': {
        contains: '"go-teams": 35',
        notContains: '"input_cost": 4.0',
      },
    },
  },
};
