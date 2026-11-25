'use strict';

module.exports = {
  id: 'action-v2/permissions-preapproved',
  component: 'action-v2',
  title: 'v2 action pre-approves caller permission rules in both configs',
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
    'INPUT_PERMISSIONS': '[{"action":"external_directory","resource":"/tmp/*","effect":"allow"},{"action":"read","resource":"/tmp/*","effect":"allow"}]',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/free-model' },
    files: {
      'home/.config/opencode/opencode.json': {
        jsonContains: {
          permissions: [
            { action: 'external_directory', resource: '/tmp/*', effect: 'allow' },
            { action: 'read', resource: '/tmp/*', effect: 'allow' },
          ],
        },
        notContains: '"permission"',
      },
      '.opencode/opencode.json': {
        jsonContains: {
          permissions: [
            { action: 'external_directory', resource: '/tmp/*', effect: 'allow' },
            { action: 'read', resource: '/tmp/*', effect: 'allow' },
          ],
        },
        notContains: '"permission"',
      },
    },
  },
};
