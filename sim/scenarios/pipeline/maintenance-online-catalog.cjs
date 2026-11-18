'use strict';

module.exports = {
  id: 'pipeline/maintenance-online-catalog',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'maintenance run builds the model config from a replayed catalog',
  net: [
    { match: 'zen/v1/models', body: { data: [{ id: 'muse-free' }, { id: 'plain' }] } },
    { match: 'zen/go/v1/models', body: { data: [{ id: 'go-pro' }] } },
    { match: 'docs/it/zen', fail: true },
    { match: 'docs/go', fail: true },
    { match: 'models.dev', fail: true },
    { match: 'LiveBench/LiveBench/main/changelog.md', body: '### 2026-01-15\n' },
    { match: 'livebench.ai/table_', body: 'model,code_completion\nmuse,90.0\nplain,40.0\n' },
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
  expect: {
    driverExit: 0,
    files: { 'pipeline/data/model-config.json': { contains: 'muse-free' } },
  },
};
