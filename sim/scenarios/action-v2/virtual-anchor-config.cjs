'use strict';

module.exports = {
  id: 'action-v2/virtual-anchor-config',
  component: 'action-v2',
  title: 'v2 action installs the configured modelselect plugin and runs on a virtual anchor',
  env: {
    'INPUT_TIER': 'auto',
    'INPUT_AUTO-PREFERENCE': 'free-first',
    'INPUT_TASK-TYPE': 'review',
    'INPUT_VERBOSE': 'true',
    'INPUT_MAX-COST': '2',
  },
  expect: {
    exit: 0,
    outputs: { model: 'modelselect/auto-free-first' },
    stdout: /modelselect plugin/,
    files: {
      'home/.config/opencode/opencode.json': {
        jsonContains: {
          plugins: [{ options: { taskType: 'review', tier: 'auto', maxCost: 2, verbose: true } }],
        },
      },
      '.opencode/opencode.json': { jsonContains: { plugins: [{ options: { taskType: 'review' } }] } },
    },
  },
};
