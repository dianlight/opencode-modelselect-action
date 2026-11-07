/* openchamber-modelselect — Plugin tab: the modelselect entry's options in
 * the OpenChamber managed OpenCode config (the only OpenCode config
 * OpenChamber's server loads).
 *
 * The panel only renders and validates: the service does the
 * read-modify-write (`POST /config {kind: 'plugin'}`) and reloads OpenCode, so
 * unknown option keys and top-level keys survive without this file knowing
 * about them. Secrets stay write-only: a blank draft keeps the stored value.
 */
import { el, str, trim, sectionTitle, shallowCopy } from './dom.js';
import { errText } from './api.js';
import {
  mkSelect,
  mkSwitch,
  mkText,
  mountCostSlider,
  parseNumCell
} from './fields.js';
import { mountBanner, mountButton } from '@openchamber/sdk/ui';

// Plugin defaults (mirror plugin/src/shared — keep in sync).
const DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json';
const DEFAULT_TASK_TYPES_URL =
  'https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json';
const DEFAULT_JEV_ENDPOINT = 'https://opencode.ai/zen/v1/systemone';
const DEFAULT_HISTORY_CHARS = 2000;
const DEFAULT_REFRESH_MINUTES = 1440;
const DEFAULT_JEV_THRESHOLD = 0.6;
const DEFAULT_JEV_TIMEOUT_MS = 10000;

const SELECT_KEYS = ['tier', 'autoPreference', 'taskType', 'defaultTaskType', 'announce', 'openchamber'];
const SWITCH_KEYS = ['verbose', 'suggestOnly', 'continuation'];
const TEXT_KEYS = ['configUrl', 'taskTypesUrl', 'jevEndpoint', 'jevModel', 'fallbackModel',
  'agentTaskMap', 'historyChars', 'configRefreshMinutes', 'jevThreshold', 'jevTimeoutMs'];

/** Option read helper: accept the plugin's camelCase and kebab-case aliases. */
function optOf(raw, camel, kebab, dflt) {
  if (!raw || typeof raw !== 'object') return dflt;
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  if (kebab && raw[kebab] !== undefined && raw[kebab] !== null) return raw[kebab];
  return dflt;
}

function typeOptions(types, withAuto) {
  const opts = [];
  if (withAuto) opts.push({ id: 'auto', label: 'auto (detect from prompt)' });
  const seen = {};
  types.forEach((t) => { seen[t] = true; });
  seen.generic = true; // plugin fallback type — always selectable
  Object.keys(seen).forEach((t) => {
    if (withAuto && t === 'auto') return;
    opts.push({ id: t, label: t });
  });
  return opts;
}

function setBanner(handle, tone, title, body) {
  if (!handle) return;
  try {
    handle.update({ tone: tone, title: title, body: body || '' });
  } catch (e) { /* banner is best-effort */ }
}

function snapshotFields(fields) {
  const snap = {};
  SELECT_KEYS.forEach((k) => { snap[k] = fields[k].value; });
  SWITCH_KEYS.forEach((k) => { snap[k] = fields[k].checked; });
  TEXT_KEYS.forEach((k) => { snap[k] = fields[k].value; });
  snap.maxCost = String(fields.cost.get());
  return snap;
}

function isDirty(fields, snap) {
  let i;
  for (i = 0; i < SELECT_KEYS.length; i += 1) {
    if (fields[SELECT_KEYS[i]].value !== snap[SELECT_KEYS[i]]) return true;
  }
  for (i = 0; i < SWITCH_KEYS.length; i += 1) {
    if (fields[SWITCH_KEYS[i]].checked !== snap[SWITCH_KEYS[i]]) return true;
  }
  for (i = 0; i < TEXT_KEYS.length; i += 1) {
    if (fields[TEXT_KEYS[i]].value !== snap[TEXT_KEYS[i]]) return true;
  }
  if (String(fields.cost.get()) !== snap.maxCost) return true;
  if (trim(fields.token.value) !== '' || trim(fields.jevToken.value) !== '') return true;
  return false;
}

/** The form's values, validated the way the service expects to receive them. */
function collect(fields) {
  const errors = [];
  const out = {
    tier: fields.tier.value,
    autoPreference: fields.autoPreference.value,
    taskType: fields.taskType.value,
    defaultTaskType: fields.defaultTaskType.value,
    announce: fields.announce.value,
    openchamber: fields.openchamber.value,
    verbose: fields.verbose.checked,
    suggestOnly: fields.suggestOnly.checked,
    continuation: fields.continuation.checked,
    configUrl: trim(fields.configUrl.value),
    taskTypesUrl: trim(fields.taskTypesUrl.value),
    jevEndpoint: trim(fields.jevEndpoint.value),
    jevModel: trim(fields.jevModel.value),
    fallbackModel: trim(fields.fallbackModel.value),
    agentTaskMapText: fields.agentTaskMap.value,
    tokenDraft: trim(fields.token.value),
    jevTokenDraft: trim(fields.jevToken.value),
    maxCost: fields.cost.get()
  };
  const grab = (key, name, opts) => {
    const r = parseNumCell(fields[key], name, opts);
    if (r.error) errors.push(r.error);
    else out[key] = r.value;
  };
  grab('historyChars', 'historyChars',
    { min: 0, integer: true, required: true, emptyValue: DEFAULT_HISTORY_CHARS });
  grab('configRefreshMinutes', 'configRefreshMinutes',
    { min: 0, integer: true, required: true, emptyValue: DEFAULT_REFRESH_MINUTES });
  grab('jevThreshold', 'jevThreshold',
    { min: 0, max: 1, required: true, emptyValue: DEFAULT_JEV_THRESHOLD });
  grab('jevTimeoutMs', 'jevTimeoutMs',
    { min: 1, integer: true, required: true, emptyValue: DEFAULT_JEV_TIMEOUT_MS });
  let map = null;
  try {
    const parsedMap = JSON.parse(trim(out.agentTaskMapText) || '{}');
    if (!parsedMap || typeof parsedMap !== 'object' || Array.isArray(parsedMap)) {
      errors.push('agentTaskMap must be a JSON object');
    } else {
      map = parsedMap;
    }
  } catch (e) {
    errors.push('agentTaskMap is not valid JSON: ' + str(e && e.message));
  }
  out.agentTaskMap = map;
  return { values: out, errors: errors };
}

/**
 * Mount the Plugin tab.
 *
 * `snapshot` is the service's `/config` answer; `ctx` carries `{ api,
 * fitHeight, reload }` — `reload()` re-reads everything and re-renders the
 * shell (used after adding a missing entry).
 */
export function mountPluginTab(pane, snapshot, ctx) {
  const managed = snapshot.managed;
  const catalog = snapshot.catalog;
  const state = { field: null, banner: null, saveHandle: null, snap: null, managed: managed };

  const refreshSave = () => {
    if (!state.fields || !state.saveHandle || !state.snap) return;
    try {
      state.saveHandle.update({ disabled: !isDirty(state.fields, state.snap) });
    } catch (e) { /* save gating is best-effort */ }
  };

  const props = (p) => Object.assign({}, p, { onEdit: refreshSave });

  const note = el('div', 'mp-file');
  note.textContent = managed.parseOk
    ? 'Writes: ' + snapshot.managedPath
    : 'Read-only: managed config could not be parsed';
  pane.append(note);

  if (snapshot.globalPaths && snapshot.globalPaths.length) {
    const g = el('div', 'mp-note');
    g.textContent = 'Also present (ignored by OpenChamber\'s server): ' +
      snapshot.globalPaths.join(', ');
    pane.append(g);
  }

  state.banner = mountBanner(pane, { tone: 'info', title: '', body: '' });

  if (!managed.parseOk) {
    setBanner(state.banner, 'error', 'Managed config is not valid JSON',
      'Nothing will be written until the file parses. Error: ' +
      (managed.parseError || 'parse failed'));
    ctx.fitHeight();
    return;
  }

  const formRoot = el('div', 'mp-form');
  pane.append(formRoot);

  const save = () => {
    const got = collect(state.fields);
    if (got.errors.length) {
      setBanner(state.banner, 'error', 'Not saved', got.errors.join(' · '));
      ctx.fitHeight();
      return;
    }
    const values = shallowCopy(got.values);
    delete values.agentTaskMapText;
    ctx.api.save('plugin', values).then((answer) => {
      // Secrets are write-only: clear the drafts, re-snapshot, re-gate.
      state.fields.token.update({ value: '' });
      state.fields.jevToken.update({ value: '' });
      state.snap = snapshotFields(state.fields);
      refreshSave();
      if (answer.reload && answer.reload.ok) {
        setBanner(state.banner, 'success', 'Plugin options saved — applied',
          'The OpenCode configuration was reloaded; the new options are live.' +
          (answer.reload.port ? ' Reloaded via OpenCode on port ' + answer.reload.port + '.' : ''));
      } else {
        setBanner(state.banner, 'warning', 'Plugin options saved — restart required',
          'Quit and reopen OpenChamber so its server reloads the plugin options. ' +
          'Reload through the local service failed: ' +
          str((answer.reload && answer.reload.error) || 'no answer') + '.');
      }
      ctx.fitHeight();
    }, (err) => {
      setBanner(state.banner, 'error', 'Not saved', errText(err));
      ctx.fitHeight();
    });
  };

  const showForm = () => {
    while (formRoot.firstChild) formRoot.removeChild(formRoot.firstChild);
    const entry = state.managed.entry;
    if (entry.form === 'string' || entry.form === 'tuple') {
      setBanner(state.banner, 'info', 'Entry is installed in plain form',
        'Save converts it to { "package": …, "options": {…} } in place, keeping its position.');
    } else if (entry.form === 'missing') {
      setBanner(state.banner, 'warning', 'No modelselect entry in the managed config',
        'Add the plugin, then configure and save.');
    } else {
      setBanner(state.banner, 'info', 'Editing: ' + entry.package, '');
    }
    state.fields = renderForm(formRoot, ctx, props);
    state.snap = snapshotFields(state.fields);
    refreshSave();
    ctx.fitHeight();
  };

  if (managed.entry.form === 'missing') {
    setBanner(state.banner, 'warning', 'No modelselect entry in the managed config',
      'Add the plugin below, then configure and save.');
    const addWrap = el('div', 'mp-foot');
    const addButton = mountButton(addWrap, {
      label: 'Add to managed config',
      variant: 'default',
      onClick: () => {
        if (state.managed.entry.form !== 'missing') return; // already added
        addButton.update({ disabled: true });
        ctx.api.addPlugin().then((answer) => {
          // Re-read everything: the service wrote the entry to disk.
          ctx.reload().catch(() => {});
          if (answer && answer.reload && answer.reload.ok) {
            ctx.toast({
              kind: 'success',
              message: 'modelselect added to the managed config — OpenCode reloaded.'
            });
          } else {
            ctx.toast({
              kind: 'warning',
              message: 'modelselect added to the managed config — reopen OpenChamber so its server loads it.'
            });
          }
        }, (err) => {
          addButton.update({ disabled: false });
          setBanner(state.banner, 'error', 'Not added', errText(err));
          ctx.fitHeight();
        });
      }
    });
    pane.append(addWrap);
  } else {
    showForm();
  }
  ctx.fitHeight();

  function renderForm(container, tabCtx, withEdit) {
    const entry = state.managed.entry;
    const raw = entry.options || {};
    const types = catalog.types;
    const fields = {};

    sectionTitle(container, 'Routing');
    fields.tier = mkSelect(container, withEdit({
      label: 'tier',
      value: str(optOf(raw, 'tier', null, 'auto')),
      options: [
        { id: 'auto', label: 'auto', hint: 'follow autoPreference' },
        { id: 'go', label: 'go', hint: 'paid Go tier' },
        { id: 'free', label: 'free', hint: 'free tier only' }
      ]
    }));
    fields.autoPreference = mkSelect(container, withEdit({
      label: 'autoPreference',
      value: str(optOf(raw, 'autoPreference', 'auto-preference', 'free-first')),
      options: [
        { id: 'free-first', label: 'free-first' },
        { id: 'go-first', label: 'go-first' }
      ]
    }));
    fields.taskType = mkSelect(container, withEdit({
      label: 'taskType',
      value: str(optOf(raw, 'taskType', 'task-type', 'auto')),
      options: typeOptions(types, true),
      searchable: true,
      searchPlaceholder: 'Filter task types…'
    }));
    fields.defaultTaskType = mkSelect(container, withEdit({
      label: 'defaultTaskType',
      value: str(optOf(raw, 'defaultTaskType', 'default-task-type', 'generic')),
      options: typeOptions(types, false),
      searchable: true,
      searchPlaceholder: 'Filter task types…'
    }));
    fields.announce = mkSelect(container, withEdit({
      label: 'announce',
      value: str(optOf(raw, 'announce', null, 'switch')),
      options: [
        { id: 'switch', label: 'switch' },
        { id: 'always', label: 'always' },
        { id: 'off', label: 'off' }
      ]
    }));
    fields.openchamber = mkSelect(container, withEdit({
      label: 'openchamber (host force)',
      value: str(optOf(raw, 'openchamber', 'open-chamber', 'auto')),
      options: [
        { id: 'auto', label: 'auto (detect)' },
        { id: 'on', label: 'on (always OpenChamber)' },
        { id: 'off', label: 'off (always standalone)' }
      ]
    }));

    sectionTitle(container, 'Budget & behavior');
    const maxCostRaw = optOf(raw, 'maxCost', null, null);
    fields.cost = mountCostSlider(container, withEdit({
      label: 'maxCost (blended $/1M)',
      min: catalog.bounds.min,
      max: catalog.bounds.max,
      value: (typeof maxCostRaw === 'number' && isFinite(maxCostRaw)) ? maxCostRaw : null
    }));
    fields.verbose = mkSwitch(container, withEdit({
      label: 'verbose',
      checked: Boolean(optOf(raw, 'verbose', null, false)),
      description: 'Log routing decisions to the OpenCode output.'
    }));
    fields.suggestOnly = mkSwitch(container, withEdit({
      label: 'suggestOnly',
      checked: Boolean(optOf(raw, 'suggestOnly', 'suggest-only', false)),
      description: 'Announce the pick without switching the model.'
    }));
    fields.continuation = mkSwitch(container, withEdit({
      label: 'continuation',
      checked: Boolean(optOf(raw, 'continuation', null, true)),
      description: 'Re-announce a stale pick when the conversation continues.'
    }));
    fields.historyChars = mkText(container, withEdit({
      label: 'historyChars',
      value: optOf(raw, 'historyChars', 'history-chars', DEFAULT_HISTORY_CHARS),
      helper: 'Chars of history considered for continuation (>= 0).',
      mono: true
    }));
    fields.configRefreshMinutes = mkText(container, withEdit({
      label: 'configRefreshMinutes',
      value: optOf(raw, 'configRefreshMinutes', null, DEFAULT_REFRESH_MINUTES),
      helper: 'Minutes before the model config cache refetches (0 = every time).',
      mono: true
    }));

    sectionTitle(container, 'Jev (refinement)');
    fields.jevEndpoint = mkText(container, withEdit({
      label: 'jevEndpoint',
      value: str(optOf(raw, 'jevEndpoint', 'jev-endpoint', DEFAULT_JEV_ENDPOINT)),
      mono: true
    }));
    fields.jevModel = mkText(container, withEdit({
      label: 'jevModel',
      value: str(optOf(raw, 'jevModel', 'jev-model', '')),
      placeholder: 'provider/id (empty = tier default)',
      mono: true
    }));
    fields.jevThreshold = mkText(container, withEdit({
      label: 'jevThreshold',
      value: optOf(raw, 'jevThreshold', 'jev-threshold', DEFAULT_JEV_THRESHOLD),
      helper: '0..1 — minimum improvement to accept a refinement.',
      mono: true
    }));
    fields.jevTimeoutMs = mkText(container, withEdit({
      label: 'jevTimeoutMs',
      value: optOf(raw, 'jevTimeoutMs', 'jev-timeout-ms', DEFAULT_JEV_TIMEOUT_MS),
      helper: 'Refinement request timeout in ms (> 0).',
      mono: true
    }));

    sectionTitle(container, 'Sources & fallback');
    fields.configUrl = mkText(container, withEdit({
      label: 'configUrl',
      value: str(optOf(raw, 'configUrl', 'config-url', DEFAULT_CONFIG_URL)),
      mono: true
    }));
    fields.taskTypesUrl = mkText(container, withEdit({
      label: 'taskTypesUrl',
      value: str(optOf(raw, 'taskTypesUrl', null, DEFAULT_TASK_TYPES_URL)),
      mono: true
    }));
    fields.fallbackModel = mkText(container, withEdit({
      label: 'fallbackModel',
      value: str(optOf(raw, 'fallbackModel', 'fallback-model', '')),
      placeholder: 'provider/id (empty = none)',
      mono: true
    }));
    fields.agentTaskMap = mkText(container, withEdit({
      label: 'agentTaskMap (JSON)',
      value: JSON.stringify(optOf(raw, 'agentTaskMap', 'agent-task-map', {}), null, 2),
      multiline: true,
      rows: 4,
      mono: true,
      helper: 'Map of agent name → task type.'
    }));

    sectionTitle(container, 'Secrets (write-only)');
    fields.token = mkText(container, withEdit({
      label: 'token',
      value: '',
      password: true,
      helper: 'Leave blank to keep the stored token — it is never shown here.'
    }));
    fields.jevToken = mkText(container, withEdit({
      label: 'jevToken',
      value: '',
      password: true,
      helper: 'Leave blank to keep the stored token — it is never shown here.'
    }));

    const foot = el('div', 'mp-foot');
    state.saveHandle = mountButton(foot, {
      label: 'Save plugin settings',
      variant: 'default',
      disabled: true, // pristine form — enabled by refreshSave on edit
      onClick: save
    });
    container.append(foot);
    return fields;
  }
}
