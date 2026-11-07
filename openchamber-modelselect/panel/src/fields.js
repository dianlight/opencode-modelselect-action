/* openchamber-modelselect — form cells over the SDK UI kit.
 *
 * The kit's mount functions return `{ update, dispose }` and keep no value
 * state of their own, so each cell mirrors the committed value here: Save
 * reads cells, and a later `update` keeps the mirror in step. `props.onEdit`
 * fires on every user edit (the plugin tab uses it for save gating).
 */
import { el, roundCost, trim } from './dom.js';
import {
  mountSelect,
  mountSwitch,
  mountTextField
} from '@openchamber/sdk/ui';

function notifyEdit(props) {
  try {
    if (props && typeof props.onEdit === 'function') props.onEdit();
  } catch (e) { /* per-field hook is best-effort */ }
}

export function mkSelect(root, props) {
  var cell = { value: props.value };
  var handle = mountSelect(root, {
    label: props.label,
    value: props.value,
    options: props.options,
    searchable: props.searchable,
    searchPlaceholder: props.searchPlaceholder,
    onChange: function (id) {
      cell.value = id;
      handle.update({ value: id });
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.value !== undefined) cell.value = next.value;
    handle.update(next);
  };
  return cell;
}

export function mkSwitch(root, props) {
  var cell = { checked: Boolean(props.checked) };
  var handle = mountSwitch(root, {
    label: props.label,
    checked: Boolean(props.checked),
    description: props.description,
    onChange: function (c) {
      cell.checked = Boolean(c);
      handle.update({ checked: cell.checked });
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.checked !== undefined) cell.checked = Boolean(next.checked);
    handle.update(next);
  };
  return cell;
}

export function mkText(root, props) {
  var cell = { value: props.value == null ? '' : String(props.value) };
  var handle = mountTextField(root, {
    label: props.label,
    value: cell.value,
    placeholder: props.placeholder,
    password: props.password,
    multiline: props.multiline,
    rows: props.rows,
    helper: props.helper,
    mono: props.mono,
    onChange: function (v) {
      cell.value = v;
      notifyEdit(props);
    }
  });
  cell.update = function (next) {
    if (next && next.value !== undefined) cell.value = String(next.value);
    handle.update(next);
  };
  return cell;
}

/** Custom maxCost slider (the kit has no range control). Rightmost = no cap. */
export function mountCostSlider(root, initial) {
  var wrap = el('div', 'mp-cost');
  var label = el('span', 'oc-sdk-field-label');
  label.textContent = initial.label || 'maxCost';
  var input = el('input', 'oc-sdk-input mp-cost-input');
  input.type = 'range';
  input.min = String(initial.min);
  input.max = String(initial.max);
  input.step = String(Math.max(0.01, roundCost(initial.max) / 200));
  var valueEl = el('span', 'mp-cost-value');
  var ticks = el('div', 'mp-cost-ticks');
  var tickMin = el('span', 'mp-cost-tick');
  tickMin.textContent = '$' + roundCost(initial.min).toFixed(2) + ' catalog min';
  var tickMax = el('span', 'mp-cost-tick mp-cost-tick-end');
  tickMax.textContent = '$' + roundCost(initial.max).toFixed(2) + ' catalog max · No limit';
  ticks.append(tickMin, tickMax);
  var note = el('span', 'oc-sdk-field-note');
  note.textContent = 'Blended $/1M cap over the ranked catalog; rightmost = no cap.';
  wrap.append(label, input, valueEl, ticks, note);
  root.append(wrap);

  var max = initial.max;
  var cell = { value: initial.value };
  var paint = function () {
    if (cell.value == null) {
      input.value = String(max);
      valueEl.textContent = 'No limit';
    } else {
      input.value = String(cell.value);
      valueEl.textContent = '$' + roundCost(cell.value).toFixed(2) + ' / 1M';
    }
  };
  input.addEventListener('input', function () {
    var v = Number(input.value);
    // Parked at the catalog max = "No limit" (the key is removed on save).
    cell.value = (!isFinite(v) || v >= max - 1e-9) ? null : v;
    paint();
    notifyEdit(initial);
  });
  // Numeric cost or null — what the service's option builder expects.
  cell.get = function () { return cell.value == null ? null : roundCost(cell.value); };
  paint();
  return cell;
}

/** Read a numeric text cell; returns { value } or { error }. */
export function parseNumCell(cell, name, opts) {
  var raw = trim(cell.value);
  if (raw === '') {
    if (opts && opts.required) return { error: name + ' is required' };
    return { value: opts && opts.emptyValue !== undefined ? opts.emptyValue : null };
  }
  var n = Number(raw);
  if (!isFinite(n)) return { error: name + ' must be a number' };
  if (opts && opts.min !== undefined && n < opts.min) {
    return { error: name + ' must be >= ' + opts.min };
  }
  if (opts && opts.max !== undefined && n > opts.max) {
    return { error: name + ' must be <= ' + opts.max };
  }
  if (opts && opts.integer && Math.floor(n) !== n) {
    return { error: name + ' must be an integer' };
  }
  return { value: n };
}
