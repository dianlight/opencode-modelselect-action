'use strict';

module.exports = {
  id: 'action-v2/valid-cli-invocation',
  component: 'action-v2',
  title: 'v2 action uses the V2 CLI run command with model, agent, variant and prompt flags',
  world: {
    files: {
      'data/model-config.json': {
        'task-types': {
          auto: { go: 'opencode-go/go-model', free: 'opencode/free-model' },
        },
      },
    },
  },
  env: {
    'INPUT_TIER': 'free',
    'INPUT_MODEL': 'opencode/free-model',
    'INPUT_AGENT': 'reviewer',
    'INPUT_VARIANT': 'high',
    'INPUT_PROMPT': 'Fix coverage issues\nUse two sources',
  },
  expect: {
    exit: 0,
    outputs: { model: 'opencode/free-model' },
    files: {
      'opencode-args.txt': {
        contains: 'run\n--model\nopencode/free-model#high\n--auto\n--agent\nreviewer\n--\nFix coverage issues\nUse two sources',
      },
    },
  },
};
