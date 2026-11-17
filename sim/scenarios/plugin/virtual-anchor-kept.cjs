'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };

module.exports = {
  id: 'plugin/virtual-anchor-kept',
  component: 'plugin',
  title: 'a session already on a virtual model keeps that anchor untouched',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: Date.now(),
        config: { 'task-types': { review: { go: 'g/a', free: 'f/b' } } },
      },
    },
  },
  options: { tier: 'free' },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'review this diff' } },
  ],
  expect: {
    plugin: {
      contextModel: VIRTUAL,
      noSwitch: true,
      promptTextContains: 'task=review tier=free → f/b',
    },
  },
};
