'use strict';

const VIRTUAL = { providerID: 'modelselect', id: 'auto-free-first' };

module.exports = {
  id: 'plugin/fixed-task-type-pin',
  component: 'plugin',
  title: 'a fixed task type overrides every prompt signal',
  seed: {
    files: {
      '.opencode/.modelselect-cache/model-config-cache.json': {
        fetchedAt: Date.now(),
        config: { 'task-types': { review: { go: 'g/a', free: 'f/b' }, docs: { go: 'g/d', free: 'f/d' } } },
      },
    },
  },
  options: { tier: 'free', taskType: 'docs' },
  steps: [
    { hook: 'context', with: { sessionID: 's1', agent: 'review', model: VIRTUAL, messages: [] } },
    { hook: 'prompt', with: { sessionID: 's1', prompt: 'review this diff' } },
  ],
  expect: { plugin: { promptTextContains: 'task=docs', promptTextNot: 'task=review' } },
};
