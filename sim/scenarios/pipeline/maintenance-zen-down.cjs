'use strict';

module.exports = {
  id: 'pipeline/maintenance-zen-down',
  component: 'pipeline',
  kind: 'maintenance',
  title: 'maintenance run degrades gracefully when every catalog fetch fails',
  net: [],
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
    files: { 'pipeline/data/model-config.json': { contains: 'task-types' } },
  },
};
