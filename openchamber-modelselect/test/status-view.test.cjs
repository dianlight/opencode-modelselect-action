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
let pickSummary;
let guestStatusViewSchema;
let GUEST_STATUS_VIEW_ICON;
let GUEST_STATUS_VIEW_ROWS_MAX;

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

before(async () => {
  const view = await import(pathToFileURL(path.join(__dirname, '..', 'service', 'src', 'view.js')).href);
  buildView = view.buildView;
  formatAge = view.formatAge;
  formatCountdown = view.formatCountdown;
  pickSummary = view.pickSummary;
  ({ guestStatusViewSchema } = await import('@openchamber/sdk/schemas'));
  ({ GUEST_STATUS_VIEW_ICON, GUEST_STATUS_VIEW_ROWS_MAX } = await import('@openchamber/sdk'));
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

function routerControl(view) {
  const found = (view.controls || []).filter((c) => c.id === 'routing-sync');
  assert.equal(found.length, 1, 'exactly one routing-sync header control');
  return found[0];
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
    assert.match(row.text, /opencode\.json/);
    assert.equal(routerControl(view).kind, 'select');
  });

  it('says no pick yet when the plugin is installed but never routed', () => {
    const view = validate(buildView(snapshot({ found: false, status: null })));
    assert.equal(rowsById(view)['no-pick'].tone, 'muted');
    assert.equal(rowsById(view)['plugin-missing'], undefined);
  });

  it('maps the pick onto lines with stable ids', () => {
    const view = validate(buildView(snapshot()));
    const rows = rowsById(view);
    assert.deepEqual(Object.keys(rows), ['task', 'tier', 'model', 'think', 'jev', 'source', 'updated']);
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

  it('gives every fixed row a schema-valid Remixicon name', () => {
    const view = validate(buildView(snapshot({
      usage: { go: { monthly: { percent: 42, limited: false } } }
    })));
    const rows = rowsById(view);
    const fixed = ['task', 'tier', 'model', 'think', 'jev', 'source', 'updated', 'usage'];
    for (const id of fixed) {
      assert.equal(typeof rows[id].icon, 'string', id + ' has an icon');
      assert.match(rows[id].icon, GUEST_STATUS_VIEW_ICON, id + ' icon matches the SDK icon pattern');
    }
    assert.equal(new Set(fixed.map((id) => rows[id].icon)).size, fixed.length, 'each row has its own icon');
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

  it('draws one row per model under each Console budget with spent/limit bar', () => {
    const view = validate(buildView(snapshot({
      usage: {
        go: { monthly: { percent: 42, limited: false, resetsAt: NOW + 3600 * 1000 } },
        budgets: [
          {
            id: 'prod-monthly',
            percent: 55,
            limited: false,
            resetsAt: NOW + 7200 * 1000,
            models: [
              { name: 'gpt-5', providerID: 'openai', modelID: 'gpt-5', spent: 12.34, limit: 50, percent: 24.68, resetsAt: NOW + 7200 * 1000 },
              { name: 'claude-4-opus', providerID: 'anthropic', modelID: 'claude-4-opus', spent: 8.90, limit: 100, percent: 8.9, resetsAt: NOW + 7200 * 1000 }
            ]
          },
          {
            id: 'research',
            percent: null,
            limited: false,
            resetsAt: null,
            models: [
              { name: 'deep-research', providerID: 'openai', modelID: 'deep-research', spent: null, limit: null, percent: null, resetsAt: null }
            ]
          }
        ]
      }
    })));
    const rows = rowsById(view);
    const gpt = rows['budget-r-prod-monthly-r-gpt-5'];
    assert.ok(gpt, 'gpt-5 budget row present');
    assert.equal(gpt.label, 'prod-monthly — gpt-5');
    assert.equal(gpt.value, '$12.34 / $50.00');
    assert.equal(gpt.content.kind, 'bar');
    assert.equal(gpt.content.value, 25);
    assert.equal(gpt.content.tone, 'success');
    const deep = rows['budget-r-research-r-deep-research'];
    assert.ok(deep, 'no-cap budget row present');
    assert.equal(deep.value, '— / no cap');
    assert.equal(deep.content, undefined, 'no percent -> no bar');
    assert.equal(deep.valueTone, 'muted');
    assert.match(gpt.tooltip, /resets in 2h 0m/);
  });

  it('caps many budget windows at the SDK maximum while the header control survives', () => {
    const budgets = [];
    for (let w = 0; w < 8; w++) {
      const models = [];
      for (let m = 0; m < 8; m++) {
        models.push({ name: 'model-' + w + '-' + m, spent: m, limit: 100, percent: m * 3, resetsAt: NOW + 3600 * 1000 });
      }
      budgets.push({ id: 'window-' + w, models });
    }
    const view = validate(buildView(snapshot({
      usage: { go: { monthly: { percent: 10, limited: false } }, budgets },
      freeQuota: null
    })));
    assert.ok(view.rows.length <= GUEST_STATUS_VIEW_ROWS_MAX, 'rows stay within the SDK cap');
    assert.equal(view.rows.length, GUEST_STATUS_VIEW_ROWS_MAX, 'the freed row is spent on budget data');
    assert.equal(routerControl(view).value, 'on', 'header control survives the cap');
    assert.equal(view.rows.some((r) => r.id === 'router'), false, 'no router row spends the budget');
    assert.equal(new Set(view.rows.map((r) => r.id)).size, view.rows.length, 'row ids stay unique');
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

  it('turns the Tier row into a select only when the entry exists', () => {
    const withEntry = rowsById(validate(buildView(snapshot({ tierOption: 'go' })))).tier;
    assert.equal(withEntry.actions.length, 1);
    assert.equal(withEntry.actions[0].kind, 'select');
    assert.equal(withEntry.actions[0].id, 'tier');
    assert.equal(withEntry.actions[0].value, 'go');
    assert.deepEqual(withEntry.actions[0].options.map((o) => o.value), ['auto', 'go', 'free']);

    const without = rowsById(validate(buildView(snapshot()))).tier;
    assert.equal(without.actions, undefined, 'no entry -> nothing to write');
  });

  it('summarises a pick for the session action toast', () => {
    const summary = pickSummary(status({ suggestOnly: true }), NOW);
    assert.equal(summary.text, 'bugfix · free · opencode/zen-free · High · suggest only · 5m ago');
    assert.equal(summary.taskType, 'bugfix');
    assert.equal(summary.model, 'opencode/zen-free');
    assert.equal(summary.stale, false);
    assert.equal(pickSummary(null, NOW), null);

    const stale = pickSummary(status({ updatedAt: NOW - 30 * 60000 }), NOW);
    assert.equal(stale.stale, true);
    assert.match(stale.text, /last known$/);
  });

  it('moves the router out of the rows into a unique header control', () => {
    const view = validate(buildView(snapshot({ tierOption: 'go' })));
    assert.equal(rowsById(view).router, undefined, 'no router row spends the cap');
    const control = routerControl(view);
    assert.equal(control.kind, 'select');
    assert.deepEqual(control.options.map((o) => o.value), ['on', 'off']);
    assert.equal(view.controls.length, 1);
    const ids = view.controls.map((c) => c.id);
    for (const row of view.rows) {
      if (row.kind !== 'line') continue;
      for (const action of row.actions || []) ids.push(action.id);
      if (row.content && row.content.kind === 'segmented') ids.push(row.content.id);
    }
    assert.equal(new Set(ids).size, ids.length, 'header and row control ids are unique');
  });

  it('keeps the header control even with many latches, and never exceeds 16 rows', () => {
    const models = {};
    for (let i = 0; i < 20; i++) {
      models['opencode/model-' + i] = { at: NOW - 60000, until: NOW + 3600000, kind: 'exhaustion' };
    }
    const view = validate(buildView(snapshot({ freeQuota: { version: 2, models } })));
    assert.equal(view.rows.length, GUEST_STATUS_VIEW_ROWS_MAX);
    assert.equal(routerControl(view).value, 'on');
  });

  it('exposes the router as a header select with on/off values', () => {
    const on = routerControl(validate(buildView(snapshot({ sync: true }))));
    assert.equal(on.kind, 'select');
    assert.deepEqual(on.options.map((o) => o.value), ['on', 'off']);
    assert.equal(on.value, 'on');
    const off = routerControl(validate(buildView(snapshot({ sync: false }))));
    assert.equal(off.value, 'off');
  });

  it('adds per-request caps and Go dollar allowance to the Model tooltip', () => {
    const view = validate(buildView(snapshot({
      pickedCaps: { output: 256000, monthlyUsage: { go: 60, 'go-plus': 240 } }
    })));
    const tooltip = rowsById(view).model.tooltip;
    assert.match(tooltip, /output cap 256k tokens\/request/);
    assert.match(tooltip, /Go allowance \$60\/mo/);
    assert.match(tooltip, /shared dollars, not a token budget/);
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
