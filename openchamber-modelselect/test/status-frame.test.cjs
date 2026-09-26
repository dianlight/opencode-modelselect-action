'use strict';

/**
 * Frame smoke test for the committed Work Status bundle
 * (`openchamber-modelselect/status/main.js`).
 *
 * Runs the bundle in a fake guest frame (node:vm + a ~60-line fake DOM +
 * a MessagePort as window.parent) speaking the real SDK wire protocol, and
 * asserts the panel renders the plugin's status file. This is the gate that
 * was missing when the frame shipped with no host bridge: the first
 * assertion (guest posts `hello`) fails for any bundle that cannot talk to
 * OpenChamber.
 *
 * Zero dependencies, Node >= 20: `node --test test/` (see package.json).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');

const BUNDLE = path.join(__dirname, '..', 'status', 'main.js');
const STATUS_DIR = '.opencode/.modelselect-cache';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal fake DOM: just enough for the view + the SDK UI kit
// (createElement, createTextNode, getElementById, append/removeChild,
// append/prepend/remove, setAttribute, dataset, textContent,
// addEventListener/click, text extraction). ---
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
  querySelector(sel) {
    const m = typeof sel === 'string' && sel.match(/\[data-id="([^"]+)"\]/);
    const found = findAll(this, (el) => (m ? el.dataset && el.dataset.id === m[1] : false));
    return found[0] || null;
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() { /* the view never unsubscribes DOM listeners */ }
  click() { for (const fn of this.listeners.click || []) fn(); }
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

// --- fake guest frame ------------------------------------------------------
function loadFrame({ files, session }) {
  const code = readFileSync(BUNDLE, 'utf8');
  const sent = [];
  const writes = [];
  const { port1 } = new MessageChannel();
  const parent = port1;
  parent.postMessage = (m) => { sent.push(m); }; // guest -> host, captured

  const listeners = [];
  const root = new FakeElement('div');
  const head = new FakeElement('head');
  const docElement = new FakeElement('html');
  docElement.scrollHeight = 100;
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
    createTextNode: (s) => ({ data: s == null ? '' : String(s) }),
    addEventListener: () => {},
  };
  const fakeWindow = {
    parent,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: () => {},
  };
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLStyleElement: FakeElement,
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
  vm.runInContext(code, sandbox, { filename: 'status/main.js' });

  const deliver = (data) => {
    const evt = new MessageEvent('message', { data, source: parent });
    for (const fn of listeners) fn(evt);
  };
  const ok = (id, payload) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: true, payload });
  const err = (id, code) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: false, error: code, code });

  // Answer every pending host request from the fixture map. Requests the
  // guest never makes (e.g. a missing bridge posts nothing) leave `sent`
  // empty, which the tests assert on.
  const pump = () => {
    const pending = sent.splice(0, sent.length);
    for (const m of pending) {
      if (!m || !m.id) continue; // hello / fire-and-forget
      if (m.type === 'file-stat') {
        const f = files.get(m.payload.path);
        ok(m.id, f ? { kind: 'file', size: f.length, mtime: Date.now() } : { kind: 'missing', size: 0, mtime: 0 });
      } else if (m.type === 'file-read') {
        const f = files.get(m.payload.path);
        if (f === undefined) err(m.id, 'NOT_FOUND');
        else ok(m.id, { content: f });
      } else if (m.type === 'file-write') {
        writes.push({ path: m.payload.path, content: m.payload.content });
        files.set(m.payload.path, m.payload.content);
        ok(m.id, { written: true });
      } else if (m.type === 'resize' || m.type === 'storage') {
        ok(m.id, {});
      }
    }
  };
  const settle = async (rounds) => {
    for (let i = 0; i < (rounds || 30); i++) {
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
        session, surface: 'status', connection: {}, settings: {},
      },
    });
    await settle();
  };

  return { root, sent, writes, ready, settle, close: () => port1.close() };
}

const DEBUG_STATUS = JSON.stringify({
  sessionID: 'ses_1', taskType: 'debug', tier: 'free',
  model: 'opencode/muse-spark-1.3-contributor-free',
  jev: 'debug@0.61', goOk: true, source: 'cache',
  suggestOnly: true, updatedAt: Date.now(),
});

const AUTO_SESSION = { id: 'ses_1', title: 't', busy: false, model: '' };

describe('modelselect status frame', () => {
  it('connects to the host and renders the per-session pick', async () => {
    const frame = loadFrame({
      files: new Map([[`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS]]),
      session: AUTO_SESSION,
    });
    try {
      // Regression gate for the missing-bridge outage: a bundle without
      // connectHost() posts nothing. hello is always first; the view also
      // fires its stat/read requests at mount (the host answers on ready).
      assert.ok(frame.sent.length >= 1);
      assert.equal(frame.sent[0].type, 'hello');

      await frame.ready();
      const txt = textOf(frame.root);
      assert.match(txt, /Task debug/);
      assert.match(txt, /Tier free/);
      assert.match(txt, /Model opencode\/muse-spark-1\.3-contributor-free/);
      assert.match(txt, /Jev debug@0\.61/);
      assert.match(txt, /Source cache/);
      assert.doesNotMatch(txt, /suggest-only/); // now an icon, not a text badge
      assert.match(txt, /Auto/); // session model is unset
      assert.doesNotMatch(txt, /bridge unavailable/);

      // Status bar icons with tooltips: Go auth + suggest-only.
      const icons = findAll(frame.root, (el) => el.className && el.className.split(' ').includes('ms-ico'));
      assert.equal(icons.length, 2);
      assert.match(icons[0].attrs.title, /Go auth OK/);
      assert.match(icons[1].attrs.title, /Suggest-only/);

      // Mode defaults to on (no mode.json): On selected, "routes every turn".
      // The mode switch is SDK kit tabs (role=tab + aria-selected).
      const tabs = findAll(frame.root, (el) => el.tagName === 'button' && el.attrs.role === 'tab');
      assert.equal(tabs.map((b) => textOf(b)).join(','), 'On,Off,Auto');
      assert.equal(tabs[0].attrs['aria-selected'], 'true');
      assert.match(txt, /routes every turn/);
    } finally {
      frame.close();
    }
  });

  it('mode switch writes mode.json', async () => {
    const frame = loadFrame({
      files: new Map([[`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS]]),
      session: AUTO_SESSION,
    });
    try {
      await frame.ready();
      const off = findAll(frame.root, (el) => el.tagName === 'button' && textOf(el) === 'Off');
      assert.equal(off.length, 1);
      off[0].click();
      await frame.settle();
      const write = frame.writes.find((w) => w.path === `${STATUS_DIR}/mode.json`);
      assert.ok(write, 'expected a mode.json write');
      assert.equal(write.content, JSON.stringify({ mode: 'off' }));
      assert.match(textOf(frame.root), /routing paused/);
    } finally {
      frame.close();
    }
  });

  it('reads a stored auto mode', async () => {
    const frame = loadFrame({
      files: new Map([
        [`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS],
        [`${STATUS_DIR}/mode.json`, JSON.stringify({ mode: 'auto' })],
      ]),
      session: AUTO_SESSION,
    });
    try {
      await frame.ready();
      const tabs = findAll(frame.root, (el) => el.tagName === 'button' && el.attrs.role === 'tab');
      assert.equal(tabs[2].attrs['aria-selected'], 'true');
      assert.match(textOf(frame.root), /routes until you pick a model/);
    } finally {
      frame.close();
    }
  });

  it('shows the managed-config fix hint when the plugin is not detected', async () => {
    const frame = loadFrame({ files: new Map(), session: AUTO_SESSION });
    try {
      await frame.ready();
      const txt = textOf(frame.root);
      assert.match(txt, /ModelSelect plugin not detected/);
      assert.match(txt, /opencode\.managed\.json/);
      assert.doesNotMatch(txt, /bridge unavailable/);
    } finally {
      frame.close();
    }
  });

  it('syncs routing categories from task types (go-first)', async () => {
    const files = new Map([
      [`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS],
      ['~/.config/openchamber/opencode.managed.json', JSON.stringify({
        plugins: [{ package: 'opencode-modelselect-plugin', options: { autoPreference: 'go-first' } }],
      })],
      [`${STATUS_DIR}/model-config-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        config: {
          'task-types': {
            plan: { go: 'opencode-go/m-plan', free: 'opencode/m-plan-free' },
            generic: { go: 'opencode-go/m-generic', free: 'opencode/m-generic-free' },
          },
        },
      })],
      [`${STATUS_DIR}/task-types-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        taskTypes: {
          plan: { label: 'Plan', description: 'Planning', jev_criteria: 'Plan work: decide structure.', agent: 'plan' },
          generic: { label: 'Generic', description: 'General', jev_criteria: 'General work.' },
          empty: { label: 'Empty', description: 'Nothing', jev_criteria: '' },
        },
      })],
      ['~/.config/openchamber/routing.json', JSON.stringify({
        version: 1,
        enabled: true,
        fallback: { model: { providerID: 'opencode-go', modelID: 'old-fallback' } },
        categories: {
          trivial: { builtin: true, model: { providerID: 'opencode', modelID: 'x-free' } },
        },
      })],
    ]);
    const frame = loadFrame({ files, session: AUTO_SESSION });
    try {
      await frame.ready();
      const writes = frame.writes.filter((w) => w.path === '~/.config/openchamber/routing.json');
      assert.ok(writes.length >= 1, 'expected a routing.json write');
      const next = JSON.parse(writes[writes.length - 1].content);
      assert.deepEqual(next.categories.plan, {
        builtin: false,
        name: 'Plan',
        description: 'Plan work: decide structure.',
        model: { providerID: 'opencode-go', modelID: 'm-plan' },
        agent: 'plan',
      });
      assert.deepEqual(next.categories.generic, {
        builtin: false,
        name: 'Generic',
        description: 'General work.',
        model: { providerID: 'opencode-go', modelID: 'm-generic' },
      });
      assert.deepEqual(next.fallback, { model: { providerID: 'opencode-go', modelID: 'm-generic' } });
      // Stale built-in disabled, never deleted; empty criteria ignored.
      assert.deepEqual(next.categories.trivial, {
        builtin: true,
        model: { providerID: 'opencode', modelID: 'x-free' },
        disabled: true,
      });
      assert.ok(!next.categories.empty, 'empty jev_criteria must not create a category');
      assert.equal(next.version, 1);
      assert.equal(next.enabled, true);
    } finally {
      frame.close();
    }
  });

  it('sync keeps the user agent when the task type sets none (free-first default)', async () => {
    const files = new Map([
      [`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS],
      ['~/.config/openchamber/opencode.managed.json', JSON.stringify({ plugins: ['opencode-modelselect-plugin'] })],
      [`${STATUS_DIR}/model-config-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        config: {
          'task-types': {
            docs: { go: 'opencode-go/m-docs', free: 'opencode/m-docs-free' },
            generic: { go: 'opencode-go/m-generic', free: 'opencode/m-generic-free' },
          },
        },
      })],
      [`${STATUS_DIR}/task-types-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        taskTypes: {
          docs: { label: 'Docs', description: 'Docs', jev_criteria: 'Document behavior.' },
          generic: { label: 'Generic', description: 'General', jev_criteria: 'General work.' },
        },
      })],
      ['~/.config/openchamber/routing.json', JSON.stringify({
        version: 1,
        categories: {
          docs: { builtin: false, name: 'Docs', description: 'stale text', agent: 'mine', model: { providerID: 'opencode', modelID: 'old' } },
          vanished: { builtin: false, name: 'Vanished', description: 'gone' },
        },
      })],
    ]);
    const frame = loadFrame({ files, session: AUTO_SESSION });
    try {
      await frame.ready();
      const writes = frame.writes.filter((w) => w.path === '~/.config/openchamber/routing.json');
      assert.ok(writes.length >= 1, 'expected a routing.json write');
      const next = JSON.parse(writes[writes.length - 1].content);
      // free-first default: free side; user agent preserved.
      assert.deepEqual(next.categories.docs, {
        builtin: false,
        name: 'Docs',
        description: 'Document behavior.',
        model: { providerID: 'opencode', modelID: 'm-docs-free' },
        agent: 'mine',
      });
      assert.equal(next.categories.vanished.disabled, true);
      assert.equal(next.categories.vanished.name, 'Vanished');
    } finally {
      frame.close();
    }
  });

  it('sync writes nothing when routing already matches', async () => {
    const files = new Map([
      [`${STATUS_DIR}/status-ses_1.json`, DEBUG_STATUS],
      ['~/.config/openchamber/opencode.managed.json', JSON.stringify({ plugins: ['opencode-modelselect-plugin'] })],
      [`${STATUS_DIR}/model-config-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        config: {
          'task-types': {
            generic: { go: 'opencode-go/m-generic', free: 'opencode/m-generic-free' },
          },
        },
      })],
      [`${STATUS_DIR}/task-types-cache.json`, JSON.stringify({
        fetchedAt: Date.now(),
        taskTypes: {
          generic: { label: 'Generic', description: 'General', jev_criteria: 'General work.' },
        },
      })],
      ['~/.config/openchamber/routing.json', JSON.stringify({
        version: 1,
        fallback: { model: { providerID: 'opencode', modelID: 'm-generic-free' } },
        categories: {
          generic: { builtin: false, name: 'Generic', description: 'General work.', model: { providerID: 'opencode', modelID: 'm-generic-free' } },
        },
      })],
    ]);
    const frame = loadFrame({ files, session: AUTO_SESSION });
    try {
      await frame.ready();
      const writes = frame.writes.filter((w) => w.path === '~/.config/openchamber/routing.json');
      assert.equal(writes.length, 0, 'expected no routing.json write when in sync');
    } finally {
      frame.close();
    }
  });
});
