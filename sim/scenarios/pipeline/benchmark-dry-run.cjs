'use strict';

module.exports = {
  id: 'pipeline/benchmark-dry-run',
  component: 'pipeline',
  kind: 'benchmark',
  title: 'backup benchmark scores an unscored free model in dry-run',
  net: [
    { match: 'chat/completions', kind: 'json', body: { choices: [{ message: { content: '10' } }] } },
  ],
  world: {
    files: { 'pipeline/tasks.yaml': { copy: 'benchmark-tasks.yaml' } },
  },
  env: { OPENCODE_API_KEY: 'sim-key' },
  freeModels: [{ id: 'sim-free' }],
  goModels: [],
  livebench: { models: {} },
  maxModels: 5,
  dryRun: true,
  expect: {
    driverExit: 0,
    files: { 'pipeline/cache.json': { contains: 'sim-free' } },
  },
};
