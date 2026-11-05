'use strict';

/**
 * Unit tests for the host-rendered status view builder
 * (`service/src/view.js`).
 *
 * The host refuses the whole answer unless it passes
 * `guestStatusViewSchema`, so every case here is validated with the real
 * SDK schema — a row that drifts out of the 16-row cap, reuses an id, or
 * carries an empty/oversized string fails the test instead of silently
 * blanking the section at runtime.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let buildView;
let formatAge;
let formatCountdown;
let guestStatusViewSchema;

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

before(async () => {
  const view = await import(pathToFileURL(path.join(__dirname, '..', 'service', 'src', 'view.js')).href);
  buildView = view.buildView;
  formatAge = view.formatAge;
  formatCountdown = view.formatCountdown;
  ({ guestStatusViewSchema } = await import('@openchamber/sdk/schemas'));
});

function validate(view) {
  const parsed = guestStatusViewSchema.safeParse(view);
  if (!parsed.success) {
    assert.fail('view does not match the host schema: ' + JSON.stringify(parsed.error.issues, null, 2) +
      '\n' + JSON.stringify(view, null, 2));
  }
  return view;
}

function rowsById(view) {
  const map = {};
  for (const row of view.rows) map[row.id] = row;
  return map;
}

function status(extra) {
  return Object.assign({
    sessionID: 'ses_test',
    taskType: 'bugfix',
    tier: 'free',
    model: 'opencode/zen-free',
    jev: 'pinned@0.8',
    goOk: false,
    think: 'high',
    variant: null,
    freeExhausted: false,
    source: 'auto',
    suggestOnly: false,
    updatedAt: NOW - 5 * 60 * 1000
  }, extra || {});
}

function snapshot(extra) {
  return Object.assign({
    now: NOW,
    directory: '/projects/demo',
    found: true,
    status: status(),
    sessionID: 'ses_test',
    knownTypes: ['bugfix', 'review'],
    sync: true,
    freeQuota: null,
    usage: null,
    globalEntry: { checked: true, entry: true }
  }, extra || {});
}

describe('status view', () => {
  it('asks for a project when none is open', () => {
    const view = validate(buildView(snapshot({ directory: null, found: false, status: null })));
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].id, 'no-project');
    assert.equal(view.rows[0].tone, 'muted');
  });

  it('shows the fix when the plugin is missing', () => {
    const view = validate(buildView(snapshot({ found: false, status: null, globalEntry: { checked: true, entry: false } })));
    const row = rowsById(view)['plugin-missing'];
    assert.equal(row.kind, 'note');
    assert.equal(row.tone, 'error');
    assert.match(row.text, /opencode\.managed\.json/);
    assert.equal(rowsById(view).router.kind, 'line');
  });

  it('says no pick yet when the plugin is installed but never routed', () => {
    const view = validate(buildView(snapshot({ found: false, status: null })));
    assert.equal(rowsById(view)['no-pick'].tone, 'muted');
    assert.equal(rowsById(view)['plugin-missing'], undefined);
  });

  it('maps the pick onto lines with stable ids', () => {
    const view = validate(buildView(snapshot()));
    const rows = rowsById(view);
    assert.deepEqual(Object.keys(rows), ['task', 'tier', 'model', 'think', 'jev', 'source', 'updated', 'router']);
    assert.equal(rows.task.value, 'bugfix');
    assert.equal(rows.tier.value, 'free');
    assert.equal(rows.tier.dot, 'error', 'goOk=false is an exhausted Go tier');
    assert.match(rows.tier.tooltip, /exhausted/);
    assert.equal(rows.model.value, 'opencode/zen-free');
    assert.equal(rows.think.value, 'High');
    assert.equal(rows.jev.value, 'pinned@0.8');
    assert.equal(rows.source.value, 'auto');
    assert.equal(rows.updated.value, '5m ago');
    assert.equal(rows.updated.badge, undefined);
  });

  it('prefers the manual think variant and flags stale/unlisted picks', () => {
    const view = validate(buildView(snapshot({
      status: status({ variant: 'low', updatedAt: NOW - 30 * 60 * 1000 }),
      knownTypes: ['review']
    })));
    const rows = rowsById(view);
    assert.equal(rows.think.value, 'Low (manual, task High)');
    assert.equal(rows.updated.badge.label, 'last known');
    assert.equal(rows.updated.badge.tone, 'warning');
    assert.equal(rows.task.badge.label, 'unlisted task');
  });

  it('marks a suggest-only pick without inventing an Auto badge', () => {
    const rows = rowsById(validate(buildView(snapshot({ status: status({ suggestOnly: true, goOk: null }) }))));
    assert.equal(rows.model.badge.label, 'suggest only');
    assert.equal(rows.tier.dot, 'muted');
    assert.equal(rows.task.badge, undefined);
  });

  it('draws the Go monthly bar with threshold tones', () => {
    const warn = rowsById(validate(buildView(snapshot({
      usage: { go: { monthly: { percent: 82.4, limited: false, resetsAt: NOW + 3600 * 1000 } } }
    })))).usage;
    assert.equal(warn.content.kind, 'bar');
    assert.equal(warn.content.tone, 'warning');
    assert.equal(warn.value, '82%');
    assert.match(warn.tooltip, /resets in 1h 0m/);

    const err = rowsById(validate(buildView(snapshot({
      usage: { go: { monthly: { percent: 100, limited: true, resetsAt: null } } }
    })))).usage;
    assert.equal(err.content.tone, 'error');
    assert.equal(err.valueTone, 'error');

    const ok = rowsById(validate(buildView(snapshot({
      usage: { go: { weekly: { percent: 12, limited: false, resetsAt: null } } }
    })))).usage;
    assert.equal(ok.content.tone, 'success');
  });

  it('hides the bar without usable usage data', () => {
    const view = validate(buildView(snapshot({ usage: { go: { monthly: { percent: null } } } })));
    assert.equal(rowsById(view).usage, undefined);
  });

  it('lists fresh free-tier latches with a live countdown and drops expired ones', () => {
    const view = validate(buildView(snapshot({
      freeQuota: {
        version: 2,
        models: {
          'opencode/zen-free': { at: NOW - 60000, until: NOW + 2 * 3600 * 1000 + 15 * 60000, kind: 'exhaustion', detail: 'quota spent' },
          'opencode/rate-limited': { at: NOW - 60000, until: NOW + 5 * 60 * 1000 + 30000, kind: 'rate-limit' },
          'opencode/gone': { at: NOW - 7200000, until: NOW - 60000, kind: 'exhaustion' }
        }
      }
    })));
    const notes = view.rows.filter((row) => row.kind === 'note');
    assert.equal(notes.length, 2);
    assert.match(notes[0].text, /Free tier exhausted — opencode\/zen-free — retry in 2h 15m · quota spent/);
    assert.match(notes[1].text, /Rate limited — opencode\/rate-limited — retry in 5m 30s/);
    assert.equal(notes[0].tone, 'warning');
  });

  it('keeps the router switch even with many latches, and never exceeds 16 rows', () => {
    const models = {};
    for (let i = 0; i < 20; i++) {
      models['opencode/model-' + i] = { at: NOW - 60000, until: NOW + 3600000, kind: 'exhaustion' };
    }
    const view = validate(buildView(snapshot({ freeQuota: { version: 2, models } })));
    assert.equal(view.rows.length, 16);
    const router = rowsById(view).router;
    assert.equal(router.content.kind, 'segmented');
    assert.equal(router.content.value, 'on');
  });

  it('turns the router row into a real control pair', () => {
    const on = rowsById(validate(buildView(snapshot({ sync: true })))).router;
    assert.deepEqual(on.content.options.map((o) => o.value), ['on', 'off']);
    assert.equal(on.content.value, 'on');
    const off = rowsById(validate(buildView(snapshot({ sync: false })))).router;
    assert.equal(off.content.value, 'off');
    assert.match(off.tooltip, /paused/);
  });

  it('clamps long model refs so the host schema still accepts them', () => {
    const long = 'opencode/' + 'x'.repeat(200);
    const view = validate(buildView(snapshot({ status: status({ model: long, jev: 'y'.repeat(200) }) })));
    const rows = rowsById(view);
    assert.ok(rows.model.value.length <= 80);
    assert.ok(rows.model.tooltip.length <= 200);
    assert.ok(rows.jev.value.length <= 80);
  });
});

describe('formatting helpers', () => {
  it('formats ages', () => {
    assert.equal(formatAge(NOW, NOW - 1000), 'just now');
    assert.equal(formatAge(NOW, NOW - 4 * 60000), '4m ago');
    assert.equal(formatAge(NOW, NOW - 3 * 3600000), '3h ago');
    assert.equal(formatAge(NOW, NOW - 50 * 3600000), '2d ago');
    assert.equal(formatAge(NOW, undefined), '—');
  });

  it('formats countdowns', () => {
    assert.equal(formatCountdown(42 * 1000), '42s');
    assert.equal(formatCountdown(5 * 60000 + 30000), '5m 30s');
    assert.equal(formatCountdown(2 * 3600000 + 15 * 60000), '2h 15m');
    assert.equal(formatCountdown(-1), '0s');
  });
});
