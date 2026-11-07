/* openchamber-modelselect — settings panel entry (ESM, bundled to IIFE).
 *
 * SOURCE FILE — do not edit panel/main.js by hand. Rebuild with:
 *   bun install && bun run build
 * and commit the bundle (panel/index.html loads ./main.js).
 *
 * The panel is presentation only: every config read and write goes through the
 * extension's local service (`api.js` → `serviceRequest`), which owns the
 * files. That is why the package declares no `files` capability and no
 * `filesystem` paths — the approval dialog lists the local service alone.
 *
 * Shell: one read per open (`GET /config`), three tabs mounted from that
 * answer, and later host `ready` snapshots only refresh the theme, so the
 * active tab and unsaved edits survive a session change. Reopen the panel (or
 * re-add the plugin) to reload from disk.
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBanner, mountTabs } from '@openchamber/sdk/ui';
import { $, el, text, str, clearNode, mountStyles } from './dom.js';
import { makeApi, errText } from './api.js';
import { mountPluginTab } from './plugin-tab.js';
import { mountExtensionTab } from './ext-tab.js';
import { mountModelsTab } from './models-tab.js';

const host = connectHost();

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1600;

/** What the host last told us: the panel is project-scoped. */
const ctx = { directory: null, session: '' };
const api = makeApi(host, {
  directory: function () { return ctx.directory; },
  session: function () { return ctx.session; }
});

let activeTabId = 'plugin';
let shellReady = false;

function sessionIDOf(snap) {
  if (!snap || typeof snap !== 'object') return '';
  return str(snap.sessionID || snap.sessionId || snap.id);
}

function fitHeight() {
  const run = function () {
    try {
      const h = (document.documentElement && document.documentElement.scrollHeight) || MIN_HEIGHT;
      const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h));
      Promise.resolve(host.setHeight(clamped)).then(function () {}, function () {});
    } catch (e) { /* host height is best-effort */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function showError(err) {
  const root = $('root');
  clearNode(root);
  const message = errText(err);
  try {
    mountBanner(root, {
      tone: 'error',
      title: 'ModelSelect settings: ' + message,
      body: 'The settings panel reads and writes through the extension\'s local service. ' +
        'Allow "Run a local service" in Settings → Extensions, then reopen this panel.'
    });
  } catch (ignored) {
    root.append(text('ModelSelect settings: ' + message));
  }
  fitHeight();
}

const tabCtx = {
  api: api,
  fitHeight: fitHeight,
  toast: function (request) { return host.toast(request); },
  reload: function () { return load(); }
};

function renderShell(snapshot) {
  const root = $('root');
  clearNode(root);
  const shell = el('div', 'mp');
  root.append(shell);

  const title = el('div', 'mp-title');
  title.textContent = 'Model select settings';
  shell.append(title);
  const note = el('div', 'mp-note');
  note.textContent = 'Plugin options live in the OpenChamber managed OpenCode config; ' +
    'the global opencode.json(c) is ignored by OpenChamber\'s server.';
  shell.append(note);

  const panes = { plugin: null, extension: null, models: null };
  const tabs = mountTabs(shell, {
    items: [
      { id: 'plugin', label: 'Plugin' },
      { id: 'extension', label: 'Extension' },
      { id: 'models', label: 'Models' }
    ],
    activeId: activeTabId,
    onChange: function (id) {
      // Commit the selection back: without this the kit keeps thinking
      // 'plugin' is active and stops firing onChange for it.
      activeTabId = id;
      tabs.update({ activeId: id });
      panes.plugin.hidden = id !== 'plugin';
      panes.extension.hidden = id !== 'extension';
      panes.models.hidden = id !== 'models';
      fitHeight();
    }
  });

  panes.plugin = el('div', 'mp-pane');
  panes.extension = el('div', 'mp-pane');
  panes.extension.hidden = true;
  panes.models = el('div', 'mp-pane');
  panes.models.hidden = true;
  shell.append(panes.plugin, panes.extension, panes.models);

  try {
    mountPluginTab(panes.plugin, snapshot, tabCtx);
    mountExtensionTab(panes.extension, snapshot, tabCtx);
    mountModelsTab(panes.models, snapshot, tabCtx);
  } catch (e) {
    showError(e);
    return;
  }
  fitHeight();
}

/** One read, one render. Called on open and after the plugin entry is added. */
function load() {
  return api.config().then(function (snapshot) {
    renderShell(snapshot);
  }, function (err) {
    showError(err);
  });
}

function mount() {
  mountStyles();
  try {
    host.onReady(function (ready) {
      try {
        if (ready && ready.theme && ready.theme.tokens) {
          applyHostReady(ready, document.documentElement);
        }
        if (ready && typeof ready.directory === 'string') ctx.directory = ready.directory;
        ctx.session = sessionIDOf(ready && ready.session);
      } catch (e) { /* theme is best-effort */ }
      if (!shellReady) {
        shellReady = true;
        load();
      } else {
        fitHeight();
      }
    });
  } catch (e) {
    showError(e);
  }
}

mount();
