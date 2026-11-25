'use strict';

module.exports = {
  id: 'pipeline/maintenance-coverage-unscorable',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'coverage audit skips non-agentic types and stealth models without benchmark data',
  net: [
    {
      match: 'zen/v1/models',
      kind: 'json',
      body: {
        data: [
          { id: 'unscored-free', type: 'chat' },
          { id: 'gemini-embedding-2', type: 'embedding' },
          { id: 'tidepool-alpha-free', type: 'chat' },
        ],
      },
    },
    {
      match: 'zen/go/v1/models',
      kind: 'json',
      body: {
        data: [
          { id: 'paid-unscored', type: 'chat' },
          { id: 'qwen3-embedding-8b', type: 'embedding' },
          { id: 'hungerg-free', type: 'chat' },
        ],
      },
    },
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
  expectFiles: ['data/coverage_issues.json'],
  expect: {
    driverExit: 0,
    files: {
      'pipeline/data/coverage_issues.json': {
        jsonContains: {
          missing_scores: [{ model: 'unscored-free' }, { model: 'paid-unscored' }],
        },
        jsonNotContains: {
          missing_scores: [
            { model: 'gemini-embedding-2' },
            { model: 'qwen3-embedding-8b' },
            { model: 'tidepool-alpha-free' },
            { model: 'hungerg-free' },
          ],
        },
      },
    },
  },
};
