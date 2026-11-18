'use strict';

module.exports = {
  id: 'pipeline/maintenance-coverage-issues',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'unscored models surface in the coverage report',
  net: [
    { match: 'zen/v1/models', kind: 'json', body: { data: [{ id: 'muse-free' }] } },
    { match: 'zen/go/v1/models', kind: 'json', body: { data: [] } },
    { match: 'docs/it/zen', kind: 'text', fail: true },
    { match: 'docs/go', kind: 'text', fail: true },
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
    files: { 'pipeline/data/coverage_issues.json': { contains: 'missing_scores' } },
  },
};
