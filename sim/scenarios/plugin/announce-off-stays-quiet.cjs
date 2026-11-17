'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };

module.exports = {
  id: 'plugin/announce-off-stays-quiet',
  component: 'plugin',
  title: 'announce=off leaves the prompt untouched while routing still happens',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: Date.now(),
        config: { 'task-types': { review: { go: 'g/a', free: 'f/b' } } },
      },
    },
  },
  options: { tier: 'free', taskType: 'review', announce: 'off' },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'review this diff' } },
  ],
  expect: { plugin: { promptTextEquals: 'review this diff', noSwitch: true } },
};
