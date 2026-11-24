'use strict';

module.exports = {
  id: 'action-v2/preselect-and-config',
  component: 'action-v2',
  title: 'v2 action preselects the model, installs the configured plugin and runs OpenCode',
  world: {
    files: {
      'data/model-config.json': {
        'task-types': {
          review: {
            go: 'opencode-go/go-model',
            free: 'opencode/free-model',
            free_ranked: [{ model: 'opencode/free-model', score: 90, blended_cost: 1 }],
          },
        },
      },
    },
  },
  env: {
    'INPUT_TIER': 'free',
    'INPUT_TASK-TYPE': 'review',
    'INPUT_VERBOSE': 'true',
    'INPUT_MAX-COST': '2',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/free-model' },
    stdout: /modelselect plugin/,
    files: {
      'home/.config/opencode/opencode.json': {
        jsonContains: {
          plugins: [{ options: { taskType: 'review', tier: 'free', maxCost: 2, verbose: true } }],
        },
      },
      '.opencode/opencode.json': { jsonContains: { plugins: [{ options: { taskType: 'review' } }] } },
    },
  },
};
