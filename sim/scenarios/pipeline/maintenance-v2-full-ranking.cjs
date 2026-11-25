'use strict';

const ids = Array.from({ length: 12 }, (_, i) => 'm' + String(i).padStart(2, '0'));
const catalog = ids.map((id) => ({ id }));
const scores = ['model,code_completion\n', ...ids.map((id, i) => `${id},${90 - i}.0\n`)].join('');
const endpointRows = ids.map((id) => `<tr><td>${id}</td><td>https://api.example/chat/completions</td></tr>`).join('');
const zenPage = `<table><tr><th>Model ID</th><th>Endpoint</th></tr>${endpointRows}</table>` +
  '<table><tr><th>Model</th><th>Input</th><th>Output</th></tr>' +
  ids.map((id, i) => i >= 10
    ? `<tr><td>${id}</td><td>Free</td><td>Free</td></tr>`
    : `<tr><td>${id}</td><td>$${0.01 + i / 100}</td><td>$${0.02 + i / 100}</td></tr>`).join('') +
  '</table>';

module.exports = {
  id: 'pipeline/maintenance-v2-full-ranking',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'maintenance publishes every scored model in the v2 chain, not just the top 10',
  net: [
    { match: 'zen/v1/models', body: { data: catalog } },
    { match: 'zen/go/v1/models', body: { data: catalog } },
    { match: 'docs/it/zen', body: zenPage },
    { match: 'docs/go', fail: true },
    { match: 'models.dev', fail: true },
    { match: 'LiveBench/LiveBench/main/changelog.md', body: '### 2026-01-15\n' },
    { match: 'livebench.ai/table_', body: scores },
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
      'pipeline/data/go_models.json': { data: [] },
      'pipeline/data/livebench.json': { models: {} },
    },
  },
  expectFiles: ['data/model-config-v2.json', 'data/model-config.json'],
  expect: {
    driverExit: 0,
    // m11 is the 12th-best model: a top-10 cutoff drops it from the v2 chain.
    files: {
      'pipeline/data/model-config-v2.json': { contains: '"m11"' },
      'pipeline/data/model-config.json': { contains: 'm11' },
    },
  },
};
