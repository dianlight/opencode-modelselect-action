'use strict';

/**
 * Frame smoke test for the committed settings-panel bundle
 * (`openchamber-modelselect/panel/main.js`).
 *
 * The panel is presentation only: every read and write is a
 * `serviceRequest` to the extension's local service. So this runs the bundle
 * in a fake guest frame (node:vm + a small fake DOM + a MessagePort as
 * window.parent) speaking the real SDK wire protocol, and forwards each
 * `service-request` to the real service bundle over HTTP with a fixture
 * project — the same path the host takes in the app.
 *
 * Covered: the form renders from the managed config, saves are read-modify-
 * write with unknown keys preserved, stored secrets never reach the DOM,
 * unparseable configs block writes, the extension tab writes both files, the
 * models tab paints the service's chain, and the panel asks for no file
 * grants at all.
 *
 * Zero dependencies, Node >= 20: `node --test test/`.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');
const {
  makeFixture,
  startService,
  managedPath,
  extConfigPath,
} = require('./helpers/service.cjs');

const BUNDLE = path.join(__dirname, '..', 'panel', 'main.js');
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

// --- fake guest frame, backed by the real service --------------------------
function loadFrame({ fixture, service }) {
  const code = readFileSync(BUNDLE, 'utf8');
  const sent = [];
  const fileCalls = [];
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

  // Forward every serviceRequest to the real service, exactly as the host
  // proxy would: bearer token, path + query, JSON body.
  const forward = async (message) => {
    const request = message.payload || {};
    const url = new URL(request.path, service.base);
    Object.entries(request.query || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    try {
      const res = await fetch(url, {
        method: request.method || 'GET',
        headers: Object.assign(
          { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' },
          {}
        ),
        body: request.body === undefined ? undefined : request.body,
      });
      ok(message.id, { status: res.status, body: await res.text() });
    } catch (e) {
      err(message.id, 'REQUEST_FAILED');
    }
  };

  const pump = async () => {
    const pending = sent.splice(0, sent.length);
    for (const m of pending) {
      if (!m || !m.id) continue; // hello / fire-and-forget
      if (m.type === 'service-request') {
        await forward(m);
      } else if (m.type === 'file-read' || m.type === 'file-write' || m.type === 'file-stat' || m.type === 'file-list') {
        fileCalls.push(m.type);
        err(m.id, 'NOT_GRANTED');
      } else if (m.type === 'resize' || m.type === 'storage' || m.type === 'toast' ||
                 m.type === 'workspace-subscribe' || m.type === 'workspace-unsubscribe') {
        ok(m.id, {});
      } else {
        err(m.id, 'BAD_PATH');
      }
    }
  };
  const settle = async (rounds) => {
    for (let i = 0; i < (rounds || 40); i++) {
      await pump();
      await sleep(5);
      if (sent.length === 0) {
        await pump();
        await sleep(5);
        if (sent.length === 0) return;
      }
    }
  };
  const ready = async (sessionID) => {
    deliver({
      channel: 'openchamber.sdk', v: 1, type: 'ready',
      payload: {
        theme: { mode: 'dark' }, locale: 'en', directory: fixture.project,
        session: { sessionID: sessionID || 'ses_test' }, surface: 'panel', connection: {}, settings: {},
      },
    });
    await settle();
  };
  return { root, sent, fileCalls, pump, settle, ready };
}

describe('panel frame', () => {
  let fixture;
  let service;

  before(async () => {
    fixture = makeFixture();
    service = await startService(fixture);
  });

  after(() => {
    if (service) service.stop();
  });

  it('posts hello and renders the plugin form from the service snapshot', async () => {
    const frame = loadFrame({ fixture, service });
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
    assert.deepEqual(frame.fileCalls, [], 'the panel must not use file grants any more');
  });

  it('enables save on edit, saves through the service, and gates again', async () => {
    const frame = loadFrame({ fixture, service });
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

    const config = JSON.parse(fs.readFileSync(managedPath(fixture), 'utf8'));
    const options = config.plugins[1].options;
    assert.equal(options.token, 'NEWSECRET');
    assert.equal(fieldInput(frame.root, 'token').value, ''); // draft cleared
    assert.equal(save().disabled, true); // saved state is the new pristine
    assert.deepEqual(frame.fileCalls, []);
  });

  it('saves with read-modify-write: unknown keys kept, blank secrets untouched', async () => {
    const frame = loadFrame({ fixture, service });
    await frame.ready();

    setField(frame.root, 'historyChars', '3000');
    findSwitch(frame.root, 'verbose').click();
    findButton(frame.root, 'Save plugin settings').click();
    await frame.settle();

    const config = JSON.parse(fs.readFileSync(managedPath(fixture), 'utf8'));
    assert.equal(config.theme, 'dark'); // top-level unknown key preserved
    assert.equal(config.plugins[0], 'some-other-plugin');
    const options = config.plugins[1].options;
    assert.equal(options.historyChars, 3000);
    assert.equal(options.verbose, true);
    assert.equal(options.token, 'NEWSECRET'); // blank draft keeps the stored value
    assert.deepEqual(options.futureOption, { keep: true }); // unknown option preserved
    assert.equal('fallbackModel' in options, false); // empty optional models are dropped
    assert.match(textOf(frame.root), /restart required/);
    assert.match(textOf(frame.root), /reopen OpenChamber/i);
  });

  it('offers to add the plugin when the managed config has no entry', async () => {
    const bare = makeFixture({ managed: JSON.stringify({ plugins: [] }) });
    const bareService = await startService(bare);
    try {
      const frame = loadFrame({ fixture: bare, service: bareService });
      await frame.ready();

      const add = findButton(frame.root, 'Add to managed config');
      add.click();
      await frame.settle();
      await frame.settle();

      assert.match(textOf(frame.root), /Save plugin settings/);
      const saved = JSON.parse(fs.readFileSync(managedPath(bare), 'utf8'));
      const added = saved.plugins.filter((p) => p && typeof p === 'object' && /modelselect/i.test(p.package || ''));
      assert.equal(added.length, 1);
      const gone = findAll(frame.root, (n) => hasClass(n, 'oc-sdk-btn') && textOf(n) === 'Add to managed config');
      assert.equal(gone.length, 0);
    } finally {
      bareService.stop();
    }
  });

  it('blocks writes when the managed config does not parse', async () => {
    const broken = makeFixture({ managed: '{ not json' });
    const brokenService = await startService(broken);
    try {
      const frame = loadFrame({ fixture: broken, service: brokenService });
      await frame.ready();

      const text = textOf(frame.root);
      assert.match(text, /Managed config is not valid JSON/);
      assert.doesNotMatch(text, /Save plugin settings/);
      assert.equal(fs.readFileSync(managedPath(broken), 'utf8'), '{ not json');
    } finally {
      brokenService.stop();
    }
  });

  it('saves the extension tab into modelselect.json and routing-sync.json', async () => {
    const frame = loadFrame({ fixture, service });
    await frame.ready();

    findTab(frame.root, 'extension').click();
    await frame.settle();

    findSwitch(frame.root, 'autoSmallModel').click();
    findButton(frame.root, 'Save extension settings').click();
    await frame.settle();

    const ext = JSON.parse(fs.readFileSync(extConfigPath(fixture), 'utf8'));
    assert.equal(ext.autoSmallModel, false);
    assert.equal(ext.autoWalkthroughModel, true);
    assert.equal(ext.keep, 'me'); // unknown key preserved

    const sync = JSON.parse(fs.readFileSync(path.join(fixture.cache, 'routing-sync.json'), 'utf8'));
    assert.equal(typeof sync.sync, 'boolean');
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

  it('paints the models chain the service returns', async () => {
    const modelsFixture = makeFixture({ status: { taskType: 'generic' } });
    const modelsService = await startService(modelsFixture);
    try {
      const frame = loadFrame({ fixture: modelsFixture, service: modelsService });
      await frame.ready();

      findTab(frame.root, 'models').click();
      await frame.settle();
      assert.equal(findTab(frame.root, 'models').attrs['aria-selected'], 'true');

      const txt = textOf(frame.root);
      // The fixture pins tier=go, so the chain is the go side under the $3 cap.
      assert.match(txt, /Pick: opencode-go\/gpt-5\.6-luna/);
      assert.match(txt, /tier=go/);
      assert.match(txt, /cap \$3\/1M/);

      const rowFor = (name) => findAll(frame.root, (n) =>
        hasClass(n, 'mp-mo') && textOf(n).includes(name))[0];
      const gemini = rowFor('gemini-4-argon');
      assert.match(textOf(gemini), /score 95\.1/);
      assert.match(textOf(gemini), /\$8\.00\/1M/);
      assert.match(textOf(gemini), /over maxCost \$3/);
      // Context window renders before the score.
      assert.match(textOf(rowFor('deepseek-v4.1-flash-free')), /opencode · 128k ctx · score 90/);

      // Bars are usage-status: the excluded rows take the full width with the
      // reason, the pick shows the Go monthly window (42% in this fixture).
      const fills = findAll(frame.root, (n) => hasClass(n, 'mp-mo-fill'));
      assert.deepEqual(fills.map((n) => n.style.width), ['100%', '42%', '100%']);
      assert.deepEqual(fills.map((n) => n.attrs['data-tone']), ['err', 'ok', 'err']);
      const barLabels = findAll(frame.root, (n) => hasClass(n, 'mp-mo-barlabel')).map((n) => textOf(n));
      assert.match(barLabels[0], /over maxCost \$3/);
      assert.equal(barLabels[1], 'PICK · Go monthly 42%');
      assert.match(barLabels[2], /quota latched · retry in 3h/);

      // Themed media icons sit top-right, one per supported modality.
      const lunaIcons = findAll(rowFor('gpt-5.6-luna'), (n) =>
        n.attrs && typeof n.attrs['data-icon'] === 'string').map((n) => n.attrs['data-icon']);
      assert.ok(lunaIcons.length >= 3, 'media icons painted');
    } finally {
      modelsService.stop();
    }
  });

  it('shows the service error when it cannot be reached', async () => {
    const dead = makeFixture();
    const deadService = await startService(dead);
    deadService.stop();
    await sleep(100);
    const frame = loadFrame({ fixture: dead, service: deadService });
    await frame.ready(undefined);
    const text = textOf(frame.root);
    assert.match(text, /local service/i);
  });
});
