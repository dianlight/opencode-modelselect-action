'use strict';

module.exports = {
  id: 'pipeline/benchmark-no-key',
  component: 'pipeline',
  kind: 'benchmark',
  title: 'backup benchmark skips itself when no API key is present',
  net: [],
  world: {
    files: { 'pipeline/tasks.yaml': { copy: 'benchmark-tasks.yaml' } },
  },
  freeModels: [{ id: 'sim-free' }],
  goModels: [],
  livebench: { models: {} },
  maxModels: 5,
  dryRun: false,
  expect: {
    driverExit: 0,
    files: { 'pipeline/cache.json': { contains: 'models' } },
  },
};
