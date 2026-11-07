/* openchamber-modelselect — Models tab: the chain the saved configuration
 * would use for a task type, in order, with the reason each row is usable or
 * excluded.
 *
 * The chain is computed by the service (`GET /chain`) with the same core the
 * plugin and the status section use, so there is one implementation of the
 * resolution and one place that reads the latch and the usage snapshot. The
 * panel only paints.
 */
import { el, str, clearNode, svgIcon, MEDIA_TIPS, MEDIA_ICON_FOR, toPromise, noop } from './dom.js';
import { errText } from './api.js';
import { mkSelect } from './fields.js';

function typeOptions(types) {
  const seen = {};
  types.forEach((t) => { seen[t] = true; });
  seen.generic = true; // plugin fallback type — always selectable
  return Object.keys(seen).map((t) => ({ id: t, label: t }));
}

function formatCost(v) {
  return '$' + (Math.round(v * 100) / 100).toFixed(2);
}

function formatCtx(v) {
  if (v >= 1000000) return (Math.round(v / 10000) / 100) + 'M';
  if (v >= 1000) return Math.round(v / 1000) + 'k';
  return String(v);
}

function initialTask(types, options, sessionTask) {
  const preferredSession = str(sessionTask);
  if (preferredSession && types.indexOf(preferredSession) >= 0) return preferredSession;
  const preferred = str(options && (options.defaultTaskType || options['default-task-type']));
  if (preferred && types.indexOf(preferred) >= 0) return preferred;
  if (types.indexOf('generic') >= 0) return 'generic';
  return types[0] || '';
}

function toast(ctx, message) {
  return toPromise(function () {
    return ctx.toast ? ctx.toast({ kind: 'info', message: message }) : null;
  }).then(noop, noop);
}

function modalityIcons(row, right, ctx) {
  (row.modalities || []).forEach((mod) => {
    const ico = el('span', 'mp-mo-ico');
    const tip = MEDIA_TIPS[mod] || ('Supports ' + mod);
    if (MEDIA_ICON_FOR[mod]) ico.appendChild(svgIcon(MEDIA_ICON_FOR[mod], ''));
    else ico.textContent = mod;
    try { ico.setAttribute('title', tip); } catch (e) { /* title is best-effort */ }
    try { ico.style.cursor = 'pointer'; } catch (e) { /* cursor is best-effort */ }
    ico.addEventListener('click', () => { toast(ctx, tip); });
    right.append(ico);
  });
}

function modelRow(row, ctx) {
  const wrap = el('div', 'mp-mo' + (row.status === 'excluded' ? ' excluded' : ''));
  const head = el('div', 'mp-mo-head');
  const name = el('span', 'mp-mo-name');
  name.textContent = row.model;
  head.append(name);
  const right = el('span', 'mp-mo-right');
  modalityIcons(row, right, ctx);
  if (row.status === 'pick') {
    const pick = el('span', 'mp-mo-pick');
    pick.textContent = 'PICK';
    right.append(pick);
  } else if (row.status === 'excluded' && row.reason) {
    const why = el('span', 'mp-mo-why');
    why.textContent = row.reason;
    right.append(why);
  }
  head.append(right);
  wrap.append(head);

  const bits = [row.provider];
  if (row.context !== null) bits.push(formatCtx(row.context) + ' ctx');
  bits.push('score ' + (row.score === null ? '—' : row.score));
  if (row.cost !== null) {
    let costBit = formatCost(row.cost) + '/1M';
    if (row.inputCost !== null && row.outputCost !== null) {
      costBit += ' (in ' + formatCost(row.inputCost) + ' / out ' + formatCost(row.outputCost) + ')';
    }
    bits.push(costBit);
  } else {
    bits.push('cost unknown');
  }
  const meta = el('div', 'mp-mo-meta');
  meta.textContent = bits.join(' · ');
  wrap.append(meta);

  const barState = row.bar || { pct: 45, tone: 'muted', label: '' };
  const barWrap = el('div', 'mp-mo-barwrap');
  const bar = el('div', 'mp-mo-bar');
  const fill = el('div', 'mp-mo-fill ' + barState.tone);
  fill.style.width = barState.pct + '%';
  try { fill.setAttribute('data-tone', barState.tone); } catch (e) { /* tone is best-effort */ }
  bar.append(fill);
  barWrap.append(bar);
  const barLabel = el('span', 'mp-mo-barlabel');
  barLabel.textContent = barState.label;
  barWrap.append(barLabel);
  wrap.append(barWrap);
  if (row.latchText) {
    const latch = el('div', 'mp-mo-latch');
    latch.textContent = row.latchText;
    wrap.append(latch);
  }
  return wrap;
}

/** Mount the Models tab: `snapshot` is the service's `/config` answer. */
export function mountModelsTab(pane, snapshot, ctx) {
  const types = (snapshot.catalog && snapshot.catalog.types) || [];
  const state = {
    task: initialTask(types, snapshot.managed.entry.options, snapshot.sessionTask),
    showExcluded: true,
    view: null,
    error: ''
  };

  const note = el('div', 'mp-file');
  note.textContent = 'Read-only preview from the saved options + catalog cache. ' +
    'The live Go quota probe can still adjust the auto pick; the bars show ' +
    'the plugin usage snapshot (local /api/experimental/usage/limits, Zen ' +
    'fallback), refreshed each turn — cost stays as text.';
  pane.append(note);

  const toolsRow = el('div', 'mp-mo-tools');
  const selectWrap = el('div', 'mp-mo-select');
  const eyeWrap = el('div', 'mp-mo-eye');
  toolsRow.append(selectWrap, eyeWrap);
  pane.append(toolsRow);
  const chainWrap = el('div', 'mp-mo-chain');
  pane.append(chainWrap);

  const paintChain = () => {
    clearNode(chainWrap);
    if (state.error) {
      const err = el('div', 'mp-mo-empty');
      err.textContent = state.error;
      chainWrap.append(err);
      ctx.fitHeight();
      return;
    }
    if (!state.view) {
      const loading = el('div', 'mp-mo-empty');
      loading.textContent = 'Loading the chain…';
      chainWrap.append(loading);
      return;
    }
    const view = state.view;
    const head = el('div', 'mp-mo-pickline');
    if (!view.found) {
      head.textContent = 'No models configured for task \u2018' + state.task + '\u2019.';
      chainWrap.append(head);
      ctx.fitHeight();
      return;
    }
    let pickText = view.pick ? ('Pick: ' + view.pick) : 'Pick: none';
    if (view.pickSource === 'fallback') pickText += ' (fallback)';
    if (view.pickNote) pickText += ' — ' + view.pickNote;
    head.textContent = pickText + ' · ' + view.sideNote +
      (view.maxCost !== null ? ' · cap $' + view.maxCost + '/1M' : ' · no cap');
    chainWrap.append(head);
    const hasCaps = view.chain.some((r) => r.context !== null || (r.modalities && r.modalities.length));
    if (view.chain.length && !hasCaps) {
      const stale = el('div', 'mp-mo-empty');
      stale.textContent = 'No capability data in the plugin cache — rows predate ' +
        'context/modalities. Refresh the cache to see them: delete ' +
        '.opencode/.modelselect-cache/model-config-cache.json in the project ' +
        'and reopen this panel (it refetches automatically otherwise).';
      chainWrap.append(stale);
    }
    const rows = view.chain.filter((r) => state.showExcluded || r.status !== 'excluded');
    if (!rows.length) {
      const empty = el('div', 'mp-mo-empty');
      empty.textContent = view.fallback
        ? 'No ranked rows — answering with the fallback model.'
        : (view.chain.length ? 'All rows excluded — toggle the eye to show them.' : 'No ranked rows for this task.');
      chainWrap.append(empty);
    }
    rows.forEach((row) => { chainWrap.append(modelRow(row, ctx)); });
    ctx.fitHeight();
  };

  const load = () => {
    state.error = '';
    state.view = null;
    paintChain();
    ctx.api.chain(state.task).then((view) => {
      state.view = view;
      paintChain();
    }, (err) => {
      state.error = 'Could not read the chain: ' + errText(err);
      paintChain();
    });
  };

  // Eye toggle: a themed icon button, not an emoji label — the kit button
  // takes text only, so this paints the SVG directly.
  const eyeBtn = el('button', 'mp-mo-eyebtn');
  eyeBtn.type = 'button';
  const paintEye = () => {
    clearNode(eyeBtn);
    const show = state.showExcluded;
    eyeBtn.appendChild(svgIcon(show ? 'eye' : 'eye-off', ''));
    try {
      eyeBtn.setAttribute('aria-label', show ? 'Hide excluded models' : 'Show excluded models');
      eyeBtn.setAttribute('title', show ? 'Hide excluded models' : 'Show excluded models');
      eyeBtn.setAttribute('data-icon', show ? 'eye' : 'eye-off');
    } catch (e) { /* labels are best-effort */ }
  };
  eyeBtn.addEventListener('click', () => {
    state.showExcluded = !state.showExcluded;
    paintEye();
    paintChain();
  });
  paintEye();
  eyeWrap.append(eyeBtn);

  const taskCell = mkSelect(selectWrap, {
    label: 'task',
    value: state.task,
    options: typeOptions(types),
    searchable: true,
    searchPlaceholder: 'Filter task types…',
    onEdit: () => {
      state.task = taskCell.value;
      load();
    }
  });

  load();
}
