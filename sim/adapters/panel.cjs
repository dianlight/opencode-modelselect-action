'use strict';

/**
 * Panel adapter: runs the committed panel bundle in a fake guest frame
 * (node:vm + a minimal DOM + a MessagePort as window.parent) speaking the
 * real SDK wire protocol, with service-request forwarded to the real service
 * bundle — the same path the OpenChamber host takes. Zero dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');
const { makeFixture, startService, globalConfigPath, extConfigPath } = require('../../openchamber-modelselect/test/helpers/service.cjs');
const { FakeElement, findAll, hasClass, textOf, fieldInput, findSwitch, findButton, findTab } = require('../engine/dom.cjs');

const BUNDLE = path.join(__dirname, '..', '..', 'openchamber-modelselect', 'panel', 'main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadFrame(fixture, service) {
  const code = fs.readFileSync(BUNDLE, 'utf8');
  const sent = [];
  const { port1 } = new MessageChannel();
  const parent = port1;
  parent.postMessage = (m) => { sent.push(m); };

  const listeners = [];
  const root = new FakeElement('div');
  root.id = 'root';
  const head = new FakeElement('head');
  const docElement = new FakeElement('html');
  docElement.scrollHeight = 900;
  docElement.hasAttribute = () => true;
  const fakeDocument = {
    readyState: 'complete',
    documentElement: docElement,
    head,
    getElementById: (id) => (id === 'root' ? root : findAll(head, (el) => el.id === id)[0] || null),
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
    for (const fn of listeners) fn(new MessageEvent('message', { data, source: parent }));
  };
  const ok = (id, payload) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: true, payload });
  const err = (id, code) => deliver({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: false, error: code, code });

  const forward = async (message) => {
    const request = message.payload || {};
    const url = new URL(request.path, service.base);
    Object.entries(request.query || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    try {
      const res = await fetch(url, {
        method: request.method || 'GET',
        headers: { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' },
        body: request.body === undefined ? undefined : request.body,
      });
      ok(message.id, { status: res.status, body: await res.text() });
    } catch {
      err(message.id, 'REQUEST_FAILED');
    }
  };

  const pump = async () => {
    const pending = sent.splice(0, sent.length);
    for (const m of pending) {
      if (!m || !m.id) continue;
      if (m.type === 'service-request') await forward(m);
      else if (m.type === 'file-read' || m.type === 'file-write' || m.type === 'file-stat' || m.type === 'file-list') err(m.id, 'NOT_GRANTED');
      else if (m.type === 'resize' || m.type === 'storage' || m.type === 'toast' || m.type === 'workspace-subscribe' || m.type === 'workspace-unsubscribe') ok(m.id, {});
      else err(m.id, 'BAD_PATH');
    }
  };
  const settle = async (rounds = 40) => {
    for (let i = 0; i < rounds; i += 1) {
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
      payload: { theme: { mode: 'dark' }, locale: 'en', directory: fixture.project, session: { sessionID: sessionID || 'ses_test' }, surface: 'panel', connection: {}, settings: {} },
    });
    await settle();
  };
  return { root, sent, settle, ready };
}

async function run(scenario, ctx) {
  const fixture = makeFixture(scenario.fixture || {});
  const service = await startService(fixture);
  const frame = loadFrame(fixture, service);
  try {
    for (const op of scenario.ops || []) {
      if (op.op === 'ready') await frame.ready(op.sessionID);
      else if (op.op === 'settle') await frame.settle(op.rounds);
      else if (op.op === 'setField') {
        const input = fieldInput(frame.root, op.label);
        input.value = String(op.value);
        input.fire('input');
        await frame.settle();
      } else if (op.op === 'clickButton') findButton(frame.root, op.label).click();
      else if (op.op === 'clickSwitch') {
        const sw = findSwitch(frame.root, op.label);
        sw.fire('click');
        await frame.settle();
      } else if (op.op === 'tab') findTab(frame.root, op.id).click();
      await frame.settle();
    }
  } finally {
    service.stop();
  }
  return {
    exit: 0,
    stdout: '',
    stderr: '',
    text: textOf(frame.root),
    fields: scenario.ops ? {} : {},
    fsRoot: fixture.root,
    calls: [],
    pluginConfig: fs.readFileSync(globalConfigPath(fixture), 'utf8'),
    extConfig: fs.readFileSync(extConfigPath(fixture), 'utf8'),
  };
}

function verify(scenario, result) {
  const failures = [];
  const e = scenario.expect || {};
  if (e.text) {
    for (const t of [].concat(e.text)) {
      if (!new RegExp(t).test(result.text)) failures.push(`panel text !~ /${t}/`);
    }
  }
  if (e.pluginConfigContains && !result.pluginConfig.includes(e.pluginConfigContains)) failures.push(`global config missing ${JSON.stringify(e.pluginConfigContains)}`);
  if (e.extConfigContains && !result.extConfig.includes(e.extConfigContains)) failures.push(`ext config missing ${JSON.stringify(e.extConfigContains)}`);
  return failures;
}

module.exports = { run, verify };
