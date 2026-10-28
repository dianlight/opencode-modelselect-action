'use strict';

/**
 * Frame smoke test for the committed settings-panel bundle
 * (`openchamber-modelselect/panel/main.js`).
 *
 * Runs the bundle in a fake guest frame (node:vm + a small fake DOM + a
 * MessagePort as window.parent) speaking the real SDK wire protocol, and
 * asserts the panel renders the plugin options from the managed OpenCode
 * config, saves with read-modify-write (unknown keys preserved), keeps
 * stored secrets out of the DOM, and blocks writes when the config does not
 * parse.
 *
 * Zero dependencies, Node >= 20: `node --test test/` (see package.json).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');

const BUNDLE = path.join(__dirname, '..', 'panel', 'main.js');
const MANAGED = '~/.config/openchamber/opencode.managed.json';
const EXTCONF = '~/.config/openchamber/modelselect.json';
const CACHE_DIR = '.opencode/.modelselect-cache';
const LATCH_FILE = CACHE_DIR + '/free-quota.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal fake DOM: just enough for the panel + the SDK UI kit ---------
function textOf(node) {
  if (node == null) return '';
  if (typeof node.data === 'string') return node.data;
  const parts = [];
  if (typeof node.textContent === 'string' && node.textContent) parts.push(node.textContent);
  if (Array.isArray(node.children)) for (const c of node.children) { const t = textOf(c); if (t) parts.push(t); }
  return parts.join(' ');
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = { setProperty: () => {} };
    this.className = '';
    this.type = '';
    this.id = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.parentNode = null;
    this._text = '';
    this.listeners = {};
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); }
  get firstChild() { return this.children[0] || null; }
  get offsetWidth() { return 320; }
  get offsetHeight() { return 120; }
  appendChild(c) { this.children.push(c); if (c && typeof c === 'object') c.parentNode = this; return c; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); return this; }
  prepend(...nodes) { for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; this.children.unshift(n); if (n && typeof n === 'object') n.parentNode = this; } return this; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  getBoundingClientRect() { return { width: 320, height: 24, left: 0, top: 0, right: 320, bottom: 24 }; }
  querySelector(sel) {
    const m = typeof sel === 'string' && sel.match(/\[data-id="([^"]+)"\]/);
    const found = findAll(this, (el) => (m ? el.dataset && el.dataset.id === m[1] : false));
    return found[0] || null;
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const list = this.listeners[t];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  fire(type, event) { for (const fn of (this.listeners[type] || []).slice()) fn(event || {}); }
  click() { this.fire('click'); }
  focus() { /* keyboard-nav target only */ }
}

function findAll(root, pred, out) {
  out = out || [];
  if (root instanceof FakeElement) {
    if (pred(root)) out.push(root);
    for (const c of root.children) findAll(c, pred, out);
  }
  return out;
}

const hasClass = (node, name) => String(node.className || '').split(/\s+/).includes(name);

// A text field: span.oc-sdk-field-label with this text; the input follows it.
function fieldInput(root, label) {
  const caption = findAll(root, (n) => hasClass(n, 'oc-sdk-field-label') && textOf(n) === label)[0];
  assert.ok(caption, `no field labelled "${label}"`);
  const field = caption.parentNode;
  const input = (field.children || []).find((c) => hasClass(c, 'oc-sdk-input'));
  assert.ok(input, `no input inside "${label}"`);
  return input;
}

function setField(root, label, value) {
  const input = fieldInput(root, label);
  input.value = String(value);
  input.fire('input');
}

function findSwitch(root, label) {
  const hit = findAll(root, (n) =>
    n.attrs && n.attrs.role === 'switch' &&
    findAll(n, (c) => hasClass(c, 'oc-sdk-check-label') && textOf(c) === label).length > 0);
  assert.ok(hit[0], `no switch labelled "${label}"`);
  return hit[0];
}

function findButton(root, label) {
  const hit = findAll(root, (n) => hasClass(n, 'oc-sdk-btn') && textOf(n) === label);
  assert.ok(hit[0], `no button labelled "${label}"`);
  return hit[0];
}

function findTab(root, id) {
  const hit = findAll(root, (n) => n.attrs && n.attrs.role === 'tab' && n.dataset.id === id);
  assert.ok(hit[0], `no tab "${id}"`);
  return hit[0];
}

// --- fake guest frame ------------------------------------------------------
function loadFrame({ files }) {
  const code = readFileSync(BUNDLE, 'utf8');
  const sent = [];
  const writes = [];
  const { port1 } = new MessageChannel();
  const parent = port1;
  parent.postMessage = (m) => { sent.push(m); }; // guest -> host, captured

  const listeners = [];
  const root = new FakeElement('div');
  root.id = 'root';
  const head = new FakeElement('head');
  const docElement = new FakeElement('html');
  docElement.scrollHeight = 900;
  // truthy hasAttribute: skip the SDK's scrollbar setup (needs a real document)
  docElement.hasAttribute = () => true;
  const fakeDocument = {
    readyState: 'complete', // mount() runs synchronously at load
    documentElement: docElement,
    head,
    getElementById: (id) => {
      if (id === 'root') return root;
      const found = findAll(head, (el) => el.id === id);
      return found[0] || null;
    },
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (s) => ({ data: s == null ? '' : String(s) }),
    addEventListener: () => {},
    querySelector: () => null,
  };
  const fakeWindow = {
    parent,
    innerWidth: 360,
    innerHeight: 800,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: () => {},
  };
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLStyleElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
    CSS: { escape: (s) => String(s) },
    MessageEvent,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Date,
    Object,
    String,
    Number,
    Array,
    Math,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'panel/main.js' });

  const deliver = (data) => {
    const evt = new MessageEvent('message', { data, source: parent });
    for (const fn of listeners) fn(evt);
  };
  const ok = (id, payload) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: true, payload });
  const err = (id, code) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: false, error: code, code });

  // Answer every pending host request from the fixture map.
  const pump = () => {
    const pending = sent.splice(0, sent.length);
    for (const m of pending) {
      if (!m || !m.id) continue; // hello / fire-and-forget
      if (m.type === 'file-stat') {
        const f = files.get(m.payload.path);
        ok(m.id, f === undefined ? { kind: 'missing', size: 0, mtime: 0 } : { kind: 'file', size: f.length, mtime: Date.now() });
      } else if (m.type === 'file-read') {
        const f = files.get(m.payload.path);
        if (f === undefined) err(m.id, 'NOT_FOUND');
        else ok(m.id, { content: f });
      } else if (m.type === 'file-write') {
        writes.push({ path: m.payload.path, content: m.payload.content });
        files.set(m.payload.path, m.payload.content);
        ok(m.id, { written: true });
      } else if (m.type === 'resize' || m.type === 'storage' || m.type === 'toast' ||
                 m.type === 'workspace-subscribe' || m.type === 'workspace-unsubscribe') {
        ok(m.id, {});
      }
    }
  };
  const settle = async (rounds) => {
    for (let i = 0; i < (rounds || 40); i++) {
      pump();
      await sleep(5); // let guest promise continuations run
      if (sent.length === 0) {
        pump();
        await sleep(5);
        if (sent.length === 0) return;
      }
    }
  };
  const ready = async () => {
    deliver({
      channel: 'openchamber.sdk', v: 1, type: 'ready',
      payload: {
        theme: { mode: 'dark' }, locale: 'en', directory: '/project',
        session: { sessionID: 'ses_test' }, surface: 'panel', connection: {}, settings: {},
      },
    });
    await settle();
  };
  return { root, sent, writes, pump, settle, ready };
}

const CATALOG = JSON.stringify({
  fetchedAt: Date.now(),
  config: {
    'task-types': {
      generic: { go_ranked: [{ model: 'a', blended_cost: 0 }, { model: 'b', blended_cost: 8 }], free_ranked: [] },
      code: { go_ranked: [{ model: 'a', blended_cost: 1.5 }], free_ranked: [] },
      'small-model': { go_ranked: [], free_ranked: [] },
    },
  },
});

function fixtureFiles(overrides) {
  const files = new Map([
    [CACHE_DIR + '/model-config-cache.json', CATALOG],
  ]);
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === undefined) files.delete(k);
    else files.set(k, v);
  }
  return files;
}

const MANAGED_OBJECT = JSON.stringify({
  theme: 'dark',
  plugins: [
    'some-other-plugin',
    {
      package: 'opencode-modelselect-plugin',
      options: {
        tier: 'go',
        verbose: false,
        maxCost: 3,
        historyChars: 1200,
        agentTaskMap: { build: 'code' },
        fallbackModel: '',
        token: 'SUPERSECRET',
        futureOption: { keep: true },
      },
    },
  ],
});

describe('panel frame', () => {
  it('posts hello and renders the plugin form from the managed config', async () => {
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: MANAGED_OBJECT }) });
    assert.ok(frame.sent.some((m) => m.type === 'hello'), 'guest never said hello');
    await frame.ready();

    const text = textOf(frame.root);
    assert.match(text, /Save plugin settings/);
    assert.match(text, /Editing: opencode-modelselect-plugin/);
    assert.match(text, /Also present|ignored by OpenChamber/i);
    assert.equal(fieldInput(frame.root, 'historyChars').value, '1200');
    // Stored secrets are never rendered.
    assert.doesNotMatch(text, /SUPERSECRET/);
    assert.equal(fieldInput(frame.root, 'token').value, '');
    assert.equal(fieldInput(frame.root, 'token').type, 'password');
    // Pristine form: nothing to save.
    assert.equal(findButton(frame.root, 'Save plugin settings').disabled, true);
  });

  it('enables save on edit and gates it again after saving', async () => {
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: MANAGED_OBJECT }) });
    await frame.ready();

    const save = () => findButton(frame.root, 'Save plugin settings');
    assert.equal(save().disabled, true);
    setField(frame.root, 'historyChars', '3000');
    assert.equal(save().disabled, false);
    setField(frame.root, 'historyChars', '1200'); // back to the loaded value
    assert.equal(save().disabled, true);
    setField(frame.root, 'token', 'NEWSECRET'); // a secret draft is a change
    assert.equal(save().disabled, false);
    save().click();
    await frame.settle();

    const write = frame.writes.find((w) => w.path === MANAGED);
    assert.ok(write, 'managed config was not written');
    assert.equal(JSON.parse(write.content).plugins[1].options.token, 'NEWSECRET');
    assert.equal(fieldInput(frame.root, 'token').value, ''); // draft cleared
    assert.equal(save().disabled, true); // saved state is the new pristine
  });

  it('saves with read-modify-write: unknown keys kept, blank secrets untouched', async () => {
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: MANAGED_OBJECT }) });
    await frame.ready();

    setField(frame.root, 'historyChars', '3000');
    findSwitch(frame.root, 'verbose').click();
    findButton(frame.root, 'Save plugin settings').click();
    await frame.settle();

    const write = frame.writes.find((w) => w.path === MANAGED);
    assert.ok(write, 'managed config was not written');
    const config = JSON.parse(write.content);
    assert.equal(config.theme, 'dark'); // top-level unknown key preserved
    assert.equal(config.plugins[0], 'some-other-plugin');
    const options = config.plugins[1].options;
    assert.equal(options.historyChars, 3000);
    assert.equal(options.verbose, true);
    assert.equal(options.token, 'SUPERSECRET'); // blank draft keeps the stored value
    assert.deepEqual(options.futureOption, { keep: true }); // unknown option preserved
    assert.equal(options.maxCost, 3); // untouched slider value survives
    assert.equal('fallbackModel' in options, false); // empty optional models are dropped
    assert.match(textOf(frame.root), /restart required/);
    assert.match(textOf(frame.root), /reopen OpenChamber/i);
  });

  it('converts a string plugin entry in place on save', async () => {
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({ plugins: ['some-other-plugin', 'opencode-modelselect-plugin'] }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    setField(frame.root, 'historyChars', '2500');
    findButton(frame.root, 'Save plugin settings').click();
    await frame.settle();

    const write = frame.writes.find((w) => w.path === MANAGED);
    assert.ok(write, 'managed config was not written');
    const plugins = JSON.parse(write.content).plugins;
    assert.equal(plugins[0], 'some-other-plugin');
    assert.equal(plugins[1].package, 'opencode-modelselect-plugin');
    assert.equal(typeof plugins[1].options, 'object');
  });

  it('offers to add the plugin when the managed config has no entry', async () => {
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: JSON.stringify({ plugins: [] }) }) });
    await frame.ready();

    const add = findButton(frame.root, 'Add to managed config');
    assert.ok(add, 'no add button');
    add.click();
    await frame.settle();
    assert.match(textOf(frame.root), /Save plugin settings/);
    // The entry exists now: the add button is gone, and clicking the
    // detached node again must not duplicate the entry.
    const gone = findAll(frame.root, (n) => hasClass(n, 'oc-sdk-btn') && textOf(n) === 'Add to managed config');
    assert.equal(gone.length, 0);
    add.click();
    await frame.settle();
    setField(frame.root, 'historyChars', '2500');
    findButton(frame.root, 'Save plugin settings').click();
    await frame.settle();
    const write = frame.writes.find((w) => w.path === MANAGED);
    assert.ok(write, 'managed config was not written');
    const added = JSON.parse(write.content).plugins.filter(
      (p) => p && typeof p === 'object' && /modelselect/i.test(p.package || ''));
    assert.equal(added.length, 1);
  });

  it('blocks writes when the managed config does not parse', async () => {
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: '{ not json' }) });
    await frame.ready();

    const text = textOf(frame.root);
    assert.match(text, /Managed config is not valid JSON/);
    assert.doesNotMatch(text, /Save plugin settings/);
    assert.equal(frame.writes.length, 0);
  });

  it('saves the extension tab into modelselect.json and routing-sync.json', async () => {
    const files = fixtureFiles({
      [MANAGED]: MANAGED_OBJECT,
      [EXTCONF]: JSON.stringify({ autoSmallModel: true, autoWalkthroughModel: true, smallModelTask: 'small-model', keep: 'me' }),
      [CACHE_DIR + '/routing-sync.json']: JSON.stringify({ sync: false, other: 1 }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'extension').click();
    await frame.settle();

    findSwitch(frame.root, 'autoSmallModel').click();
    findButton(frame.root, 'Save extension settings').click();
    await frame.settle();

    const extWrite = frame.writes.find((w) => w.path === EXTCONF);
    assert.ok(extWrite, 'modelselect.json was not written');
    const ext = JSON.parse(extWrite.content);
    assert.equal(ext.autoSmallModel, false);
    assert.equal(ext.autoWalkthroughModel, true);
    assert.equal(ext.smallModelTask, 'small-model');
    assert.equal(ext.keep, 'me'); // unknown key preserved

    const syncWrite = frame.writes.find((w) => w.path === CACHE_DIR + '/routing-sync.json');
    assert.ok(syncWrite, 'routing-sync.json was not written');
    const sync = JSON.parse(syncWrite.content);
    assert.equal(sync.sync, false); // switch unchanged: keeps the current value
    assert.equal(sync.other, 1);
    assert.match(textOf(frame.root), /Applies on the next turn/);

    // Round-trip: the plugin tab must stay selectable after visiting
    // the extension tab (the kit only fires onChange for a tab that is
    // not already active, so the selection has to be committed back).
    findTab(frame.root, 'plugin').click();
    await frame.settle();
    assert.equal(findTab(frame.root, 'plugin').attrs['aria-selected'], 'true');
    assert.equal(findTab(frame.root, 'extension').attrs['aria-selected'], 'false');
    findButton(frame.root, 'Save plugin settings'); // plugin form is back
  });

  it('shows the models chain for the default task with pick and exclusions', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'auto', autoPreference: 'free-first', maxCost: 2, defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'opencode-go/gpt-5.6-luna',
              free: 'opencode/deepseek-v4.1-flash-free',
              go_ranked: [
                { model: 'opencode-go/gemini-4-argon', score: 95.1, input_cost: 4, output_cost: 20, blended_cost: 8, context: 1048576, modalities: ['text', 'image'] },
                { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
              ],
              free_ranked: [
                { model: 'opencode/deepseek-v4.1-flash-free', score: 90, input_cost: 0, output_cost: 0, blended_cost: 0, context: 128000, modalities: ['text'] },
              ],
            },
            code: {
              go: 'opencode-go/gpt-5.6-luna',
              free: 'opencode/x-free',
              go_ranked: [
                { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
              ],
              free_ranked: [
                { model: 'opencode/x-free', score: 80, input_cost: 0, output_cost: 0, blended_cost: 0 },
              ],
            },
          },
        },
      }),
      [LATCH_FILE]: JSON.stringify({
        version: 2,
        models: {
          'opencode/deepseek-v4.1-flash-free': {
            at: now - 1000, until: now + 3 * 3600 * 1000 + 5 * 60 * 1000,
            kind: 'exhaustion', detail: 'spent', updatedAt: now,
          },
        },
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();
    assert.equal(findTab(frame.root, 'models').attrs['aria-selected'], 'true');

    // Free side latched → failover to go; luna fits the $2 cap.
    const txt = textOf(frame.root);
    assert.match(txt, /Pick: opencode-go\/gpt-5\.6-luna/);
    assert.match(txt, /cap \$2\/1M/);
    // Ranked rows carry provider, score and costs.
    assert.match(txt, /opencode-go.*score 95\.1.*\$8\.00\/1M/);
    assert.match(txt, /\$0\.50 \/ \$2\.00 limit/);
    // Exclusions are grayed with reasons.
    const excluded = findAll(frame.root, (n) =>
      String(n.className || '').split(' ').includes('mp-mo') &&
      String(n.className || '').split(' ').includes('excluded'));
    assert.equal(excluded.length, 2);
    assert.match(textOf(excluded[0]), /over maxCost \$2/);
    assert.match(textOf(excluded[1]), /quota latched · retry in 3h/);
    // Limit bars: over-budget clamps to full, the pick sits at 25%.
    const fills = findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'))
      .map((n) => n.style.width);
    assert.deepEqual(fills, ['100%', '25%', '0%']);
    // Context window renders before the score; media icons sit top-right.
    const rowFor = (name) => findAll(frame.root, (n) =>
      hasClass(n, 'mp-mo') && textOf(n).includes(name))[0];
    assert.match(textOf(rowFor('deepseek-v4.1-flash-free')), /opencode · 128k ctx · score 90/);
    assert.match(textOf(rowFor('gpt-5.6-luna')), /🖼️/);
    assert.match(textOf(rowFor('gpt-5.6-luna')), /📄/);
    assert.match(textOf(rowFor('gemini-4-argon')), /1\.05M ctx/);

    // Eye toggle: hiding excluded models leaves only the pick; the
    // button flips to the barred eye and back.
    const eye = () => findButton(frame.root, modelsHidden ? '🙈' : '👁');
    var modelsHidden = false;
    eye().click();
    await frame.settle();
    modelsHidden = true;
    assert.equal(findAll(frame.root, (n) =>
      String(n.className || '').split(' ').includes('excluded')).length, 0);
    assert.deepEqual(findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'))
      .map((n) => n.style.width), ['25%']);
    assert.match(textOf(frame.root), /Pick: opencode-go\/gpt-5\.6-luna/);
    eye().click();
    await frame.settle();
    modelsHidden = false;
    assert.equal(findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill')).length, 3);
  });

  it('shows the off-side chain grayed when the preference picks free', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'auto', autoPreference: 'free-first', defaultTaskType: 'code' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            code: {
              go: 'opencode-go/gpt-5.6-luna',
              free: 'opencode/x-free',
              go_ranked: [
                { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text', 'image', 'pdf'] },
              ],
              free_ranked: [
                { model: 'opencode/x-free', score: 80, input_cost: 0, output_cost: 0, blended_cost: 0 },
              ],
            },
          },
        },
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    // Default task follows the saved defaultTaskType: no popup needed.
    findTab(frame.root, 'models').click();
    await frame.settle();

    const txt = textOf(frame.root);
    assert.match(txt, /Pick: opencode\/x-free/);
    assert.match(txt, /off-side · auto → free-first/);
    assert.match(txt, /no cap/);
    // Unknown capabilities: score without a ctx segment, no media icons.
    const xfree = findAll(frame.root, (n) =>
      hasClass(n, 'mp-mo') && textOf(n).includes('x-free'))[0];
    assert.match(textOf(xfree), /score 80/);
    assert.doesNotMatch(textOf(xfree), /ctx/);
    assert.equal(findAll(xfree, (n) => hasClass(n, 'mp-mo-ico')).length, 0);
  });

  it('hints at a stale cache when rows carry no capability data', async () => {
    // Shared CATALOG rows predate context/modalities: the pane says so
    // instead of silently showing no icons.
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: MANAGED_OBJECT }) });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();

    assert.match(textOf(frame.root), /No capability data in the plugin cache/);
    assert.match(textOf(frame.root), /model-config-cache\.json/);
  });
});
