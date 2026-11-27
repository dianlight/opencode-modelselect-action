'use strict';

module.exports = {
  id: 'service/turn-event-delivery-state',
  component: 'service',
  title: 'turn session events become per-session delivery state in /pick and /status',
  steps: [
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
    {
      method: 'POST',
      path: '/session-events',
      body: {
        v: 1,
        requestId: 'req_delivery',
        event: {
          id: 'evt_delivery',
          type: 'turn-finished',
          at: 1730000000123,
          session: { id: 'ses_test', parentId: null },
          project: { directory: '{{project}}' },
          linked: [],
        },
        content: {
          type: 'turn-finished',
          sessionTitle: 'Fix the parser',
          reply: 'Done: the wait fired after the pull request merged.',
          replyTruncated: false,
        },
      },
    },
    { method: 'GET', path: '/pick', query: { directory: '{{project}}', session: 'ses_test' } },
    { method: 'GET', path: '/status', query: { directory: '{{project}}' } },
  ],
  expect: {
    http: [
      { status: 200 },
      { status: 200, jsonContains: { ok: true } },
      { status: 200, jsonContains: { delivery: 'idle — Done: the wait fired after the pull request merged.' } },
      { status: 200, jsonContains: { rows: [{ id: 'delivery', value: 'idle' }] } },
    ],
    files: {
      'project/.opencode/.modelselect-cache/delivery-ses_test.json': {
        jsonContains: { activity: 'idle', reply: 'Done: the wait fired after the pull request merged.' },
      },
    },
  },
};
