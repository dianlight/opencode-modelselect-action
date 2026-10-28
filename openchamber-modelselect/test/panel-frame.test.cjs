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
  const ready = async (sessionID) => {
    deliver({
      channel: 'openchamber.sdk', v: 1, type: 'ready',
      payload: {
        theme: { mode: 'dark' }, locale: 'en', directory: '/project',
        session: { sessionID: sessionID || 'ses_test' }, surface: 'panel', connection: {}, settings: {},
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
    // Bars are usage-status, not cost: no usage snapshot here, so every
    // bar renders the row status at full width with a tone class.
    const fills = findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'));
    assert.deepEqual(fills.map((n) => n.style.width), ['100%', '100%', '100%']);
    assert.deepEqual(fills.map((n) => n.attrs['data-tone']), ['err', 'ok', 'err']);
    const barLabels = findAll(frame.root, (n) => hasClass(n, 'mp-mo-barlabel'))
      .map((n) => textOf(n));
    assert.match(barLabels[0], /over maxCost \$2/);
    assert.equal(barLabels[1], 'PICK');
    assert.match(barLabels[2], /quota latched · retry in 3h/);
    const excluded = findAll(frame.root, (n) =>
      String(n.className || '').split(' ').includes('mp-mo') &&
      String(n.className || '').split(' ').includes('excluded'));
    assert.equal(excluded.length, 2);
    assert.match(textOf(excluded[0]), /over maxCost \$2/);
    assert.match(textOf(excluded[1]), /quota latched · retry in 3h/);
    // Context window renders before the score; themed media icons sit top-right.
    const rowFor = (name) => findAll(frame.root, (n) =>
      hasClass(n, 'mp-mo') && textOf(n).includes(name))[0];
    assert.match(textOf(rowFor('deepseek-v4.1-flash-free')), /opencode · 128k ctx · score 90/);
    const lunaIcons = findAll(rowFor('gpt-5.6-luna'), (n) =>
      n.attrs && typeof n.attrs['data-icon'] === 'string').map((n) => n.attrs['data-icon']);
    assert.ok(lunaIcons.includes('image'), `luna row lacks the image icon: ${lunaIcons}`);
    assert.ok(lunaIcons.includes('file-pdf'), `luna row lacks the pdf icon: ${lunaIcons}`);
    assert.ok(!lunaIcons.some((i) => /📝|🖼|📄|🔊|🎬|📎|👁|🙈/.test(i)), 'emoji icons remain');
    assert.match(textOf(rowFor('gemini-4-argon')), /1\.05M ctx/);

    // Eye toggle: hiding excluded models leaves only the pick; the
    // themed button flips between the eye and eye-off icons.
    const eyeBtn = () => findAll(frame.root, (n) =>
      String(n.className || '').split(' ').includes('mp-mo-eyebtn'))[0];
    assert.ok(eyeBtn(), 'no eye toggle button');
    assert.equal(eyeBtn().attrs['data-icon'], 'eye');
    eyeBtn().click();
    await frame.settle();
    assert.equal(eyeBtn().attrs['data-icon'], 'eye-off');
    assert.equal(findAll(frame.root, (n) =>
      String(n.className || '').split(' ').includes('excluded')).length, 0);
    assert.deepEqual(findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'))
      .map((n) => n.style.width), ['100%']);
    assert.match(textOf(frame.root), /Pick: opencode-go\/gpt-5\.6-luna/);
    eyeBtn().click();
    await frame.settle();
    assert.equal(eyeBtn().attrs['data-icon'], 'eye');
    assert.equal(findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill')).length, 3);
  });

  it('drives the Go bars from the plugin usage snapshot', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'auto', autoPreference: 'go-first', defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'opencode-go/gpt-5.6-luna',
              free: 'opencode/x-free',
              go_ranked: [
                { model: 'opencode-go/gpt-5.6-luna', score: 93, input_cost: 0.2, output_cost: 1.2, blended_cost: 0.5, context: 1050000, modalities: ['text'] },
              ],
              free_ranked: [
                { model: 'opencode/x-free', score: 80, input_cost: 0, output_cost: 0, blended_cost: 0 },
              ],
            },
          },
        },
      }),
      [CACHE_DIR + '/usage-limits.json']: JSON.stringify({
        fetchedAt: now,
        source: 'limits',
        go: {
          monthly: { percent: 42, limited: false, resetsAt: now + 3600e3 },
          weekly: { percent: 10, limited: false, resetsAt: null },
          rolling: { percent: null, limited: false, resetsAt: null },
        },
        budgets: [],
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();

    const fills = findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'));
    const labels = findAll(frame.root, (n) => hasClass(n, 'mp-mo-barlabel'))
      .map((n) => textOf(n));
    // Go pick shows the consumed monthly window; the off-side free row
    // shows its exclusion reason instead of a cost ratio.
    assert.deepEqual(fills.map((n) => n.style.width), ['42%', '100%']);
    assert.deepEqual(fills.map((n) => n.attrs['data-tone']), ['ok', 'muted']);
    assert.equal(labels[0], 'PICK · Go monthly 42%');
    assert.match(labels[1], /off-side · auto → go-first/);
  });

  it('gives each media icon a tooltip and click-to-toast description', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'auto', autoPreference: 'free-first', maxCost: 10, defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'opencode-go/m-a',
              free: 'opencode/m-b',
              go_ranked: [
                { model: 'opencode-go/m-a', score: 90, input_cost: 1, output_cost: 2, blended_cost: 1.5, context: 1000, modalities: ['text', 'image', 'pdf', 'audio', 'video', 'file', 'mystery'] },
              ],
              free_ranked: [],
            },
          },
        },
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();

    const icons = findAll(frame.root, (n) => hasClass(n, 'mp-mo-ico'));
    assert.ok(icons.length >= 7, `expected 7 media icons, got ${icons.length}`);
    const expected = {
      'file-text': 'Text input supported',
      'image': 'Image input supported',
      'file-pdf': 'PDF input supported',
      'audio': 'Audio input supported',
      'video': 'Video input supported',
      'attachment': 'File input supported',
    };
    assert.equal(icons.length, 7);
    for (const ico of icons) {
      const inner = (ico.children || []).find((c) => c.attrs && c.attrs['data-icon']);
      const title = typeof ico.getAttribute === 'function' ? ico.getAttribute('title') : ico.attrs.title;
      if (inner) {
        assert.equal(title, expected[inner.attrs['data-icon']]);
      } else {
        // Unknown modality renders as raw text with a generic tip.
        assert.equal(ico.textContent, 'mystery');
        assert.equal(title, 'Supports mystery');
      }
    }
    // Clicking an icon toasts its description (native titles don't
    // surface in the sandboxed frame). The click posts synchronously;
    // inspect before settle() pumps (and drains) the outbox.
    assert.ok(Array.isArray(icons[1].listeners.click) && icons[1].listeners.click.length > 0);
    icons[1].click(); // image icon
    const toast = frame.sent.find((m) => m.type === 'toast');
    assert.ok(toast, 'icon click did not send a toast');
    assert.equal(toast.payload.message, 'Image input supported');
    await frame.settle();
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

  it('keeps the tab and unsaved edits when ready fires again', async () => {
    // The host pushes fresh snapshots while a session runs; those must
    // not rebuild the shell (and yank the user back to Plugin).
    const frame = loadFrame({ files: fixtureFiles({ [MANAGED]: MANAGED_OBJECT }) });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();
    assert.match(textOf(frame.root), /Save plugin settings/); // plugin form mounted
    findTab(frame.root, 'plugin').click();
    await frame.settle();
    setField(frame.root, 'historyChars', '3000'); // unsaved edit

    await frame.ready(); // second ready, as mid-session snapshots do
    assert.equal(findTab(frame.root, 'plugin').attrs['aria-selected'], 'true');
    assert.equal(fieldInput(frame.root, 'historyChars').value, '3000');
    assert.equal(findButton(frame.root, 'Save plugin settings').disabled, false);

    findTab(frame.root, 'extension').click();
    await frame.settle();
    await frame.ready();
    assert.equal(findTab(frame.root, 'extension').attrs['aria-selected'], 'true');
    assert.match(textOf(frame.root), /Save extension settings/);
  });

  it('preselects the models task from the current session status file', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'go', defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'go/generic-pick', free: '',
              go_ranked: [{ model: 'go/generic-pick', score: 90, blended_cost: 1 }],
              free_ranked: [],
            },
            code: {
              go: 'go/code-pick', free: '',
              go_ranked: [{ model: 'go/code-pick', score: 91, blended_cost: 1 }],
              free_ranked: [],
            },
          },
        },
      }),
      [CACHE_DIR + '/status-ses_test.json']: JSON.stringify({
        sessionID: 'ses_test', taskType: 'code', tier: 'go',
        model: 'go/code-pick', updatedAt: now,
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();
    // Saved defaultTaskType is generic; the live session status wins.
    assert.match(textOf(frame.root), /Pick: go\/code-pick/);
  });

  it('sanitizes the sessionID when locating the status file', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'go', defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'go/generic-pick', free: '',
              go_ranked: [{ model: 'go/generic-pick', score: 90, blended_cost: 1 }],
              free_ranked: [],
            },
            code: {
              go: 'go/code-pick', free: '',
              go_ranked: [{ model: 'go/code-pick', score: 91, blended_cost: 1 }],
              free_ranked: [],
            },
          },
        },
      }),
      // 'a/b c' sanitizes to 'a_b_c' (mirror of status sanitizeSessionID).
      [CACHE_DIR + '/status-a_b_c.json']: JSON.stringify({
        sessionID: 'a/b c', taskType: 'code', tier: 'go',
        model: 'go/code-pick', updatedAt: now,
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready('a/b c');

    findTab(frame.root, 'models').click();
    await frame.settle();
    assert.match(textOf(frame.root), /Pick: go\/code-pick/);
  });

  it('falls back to defaultTaskType when the session status task is unknown or unreadable', async () => {
    const now = Date.now();
    const catalog = JSON.stringify({
      fetchedAt: now,
      config: {
        'task-types': {
          generic: {
            go: 'go/generic-pick', free: '',
            go_ranked: [{ model: 'go/generic-pick', score: 90, blended_cost: 1 }],
            free_ranked: [],
          },
          code: {
            go: 'go/code-pick', free: '',
            go_ranked: [{ model: 'go/code-pick', score: 91, blended_cost: 1 }],
            free_ranked: [],
          },
        },
      },
    });
    const managed = JSON.stringify({
      plugins: [{
        package: 'opencode-modelselect-plugin',
        options: { tier: 'go', defaultTaskType: 'generic' },
      }],
    });
    for (const status of [
      JSON.stringify({ sessionID: 'ses_test', taskType: 'nope-unknown', updatedAt: now }),
      '{ not json',
    ]) {
      const frame = loadFrame({ files: fixtureFiles({
        [MANAGED]: managed,
        [CACHE_DIR + '/model-config-cache.json']: catalog,
        [CACHE_DIR + '/status-ses_test.json']: status,
      }) });
      await frame.ready();
      findTab(frame.root, 'models').click();
      await frame.settle();
      assert.match(textOf(frame.root), /Pick: go\/generic-pick/, `status: ${status}`);
    }
    // Missing status file also falls back.
    const missing = loadFrame({ files: fixtureFiles({
      [MANAGED]: managed,
      [CACHE_DIR + '/model-config-cache.json']: catalog,
    }) });
    await missing.ready();
    findTab(missing.root, 'models').click();
    await missing.settle();
    assert.match(textOf(missing.root), /Pick: go\/generic-pick/);
  });

  it('keeps the preselected task when ready fires again', async () => {
    const now = Date.now();
    const files = fixtureFiles({
      [MANAGED]: JSON.stringify({
        plugins: [{
          package: 'opencode-modelselect-plugin',
          options: { tier: 'go', defaultTaskType: 'generic' },
        }],
      }),
      [CACHE_DIR + '/model-config-cache.json']: JSON.stringify({
        fetchedAt: now,
        config: {
          'task-types': {
            generic: {
              go: 'go/generic-pick', free: '',
              go_ranked: [{ model: 'go/generic-pick', score: 90, blended_cost: 1 }],
              free_ranked: [],
            },
            code: {
              go: 'go/code-pick', free: '',
              go_ranked: [{ model: 'go/code-pick', score: 91, blended_cost: 1 }],
              free_ranked: [],
            },
          },
        },
      }),
      [CACHE_DIR + '/status-ses_test.json']: JSON.stringify({
        sessionID: 'ses_test', taskType: 'code', tier: 'go',
        model: 'go/code-pick', updatedAt: now,
      }),
    });
    const frame = loadFrame({ files });
    await frame.ready();

    findTab(frame.root, 'models').click();
    await frame.settle();
    assert.match(textOf(frame.root), /Pick: go\/code-pick/);

    // The session now reports a different task on disk, but preselect
    // happened once: a later ready must not reselect or rebuild.
    files.set(CACHE_DIR + '/status-ses_test.json', JSON.stringify({
      sessionID: 'ses_test', taskType: 'generic', tier: 'go',
      model: 'go/generic-pick', updatedAt: Date.now(),
    }));
    await frame.ready();
    assert.equal(findTab(frame.root, 'models').attrs['aria-selected'], 'true');
    assert.match(textOf(frame.root), /Pick: go\/code-pick/);
  });
});
