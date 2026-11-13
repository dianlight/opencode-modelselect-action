/* Answers the agent's permission requests and forms on the user's behalf.
 *
 * The service sees a request through the `permission-asked` / `question-asked`
 * session events it subscribes to (`contributes.sessionEvents`). What it may
 * answer is deliberately small:
 *
 * - a permission is allowed once, with a message that says who allowed it.
 *   An answer is one-shot by contract: nothing here ever creates a standing
 *   rule, which stays a click in the app.
 * - a form is answered with the values the service already holds: the
 *   session's project directory and the plugin's current pick for that
 *   session. Every other field keeps its default.
 * - a `page` is never answered: a page cannot be answered from a service, so
 *   it is sent to the session, which closes it as when the user writes in the
 *   chat.
 *
 * The functions here are pure: the wiring to the host lives in main.js.
 */

/** The message that reaches the agent with an allowed permission. */
export const PERMISSION_MESSAGE =
  'Model select allowed this once. Ask the user to allow it always if it should repeat.';

/** The message that closes a page the service cannot answer. */
export const PAGE_MESSAGE =
  'Model select cannot answer a page — answer it in the app to continue this turn.';

/** The message that reaches the agent with a filled form. */
export function formMessage(values) {
  const keys = Object.keys(values || {});
  if (!keys.length) {
    return 'Model select answered this form with its defaults; no field was computable.';
  }
  return 'Model select filled ' + keys.join(', ') + '; every other field keeps its default.';
}

/**
 * The values the service holds for one session: its project directory and the
 * plugin's pick for it. `known` keys are `directory`, `model`, `task`, `tier`.
 */
export function knownValues(directory, pick) {
  const known = {};
  if (typeof directory === 'string' && directory) known.directory = directory;
  if (pick && typeof pick.model === 'string' && pick.model) known.model = pick.model;
  if (pick && typeof pick.taskType === 'string' && pick.taskType) known.task = pick.taskType;
  if (pick && typeof pick.tier === 'string' && pick.tier) known.tier = pick.tier;
  return known;
}

/**
 * The field keys each known value answers. A key is normalized (lower case,
 * letters and digits only), so `project_directory` and `Project Directory`
 * are the same key.
 */
const FIELD_KEYS = {
  directory: ['directory', 'project', 'projectdirectory', 'path', 'cwd', 'workdir', 'workspace'],
  model: ['model', 'modelid'],
  task: ['task', 'tasktype'],
  tier: ['tier'],
};

/**
 * The values a form is answered with, keyed by the form's field `key`.
 *
 * A field is answered only when the service can compute its value: a known
 * value under a matching key, or a choice with exactly one option. Fields
 * left out keep their default, and a field whose `when` conditions do not
 * hold is not asked at all — its value would be dropped by the host anyway.
 */
export function computeFormValues(fields, known) {
  const values = {};
  if (!Array.isArray(fields)) return values;
  for (const field of fields) {
    if (!field || typeof field.key !== 'string' || !field.key) continue;
    if (!fieldIsAsked(field, values)) continue;
    const value = fieldValue(field, known || {});
    if (value !== undefined) values[field.key] = value;
  }
  return values;
}

/** Does the form ask this field, given the values computed so far? */
function fieldIsAsked(field, values) {
  if (!Array.isArray(field.when) || !field.when.length) return true;
  for (const condition of field.when) {
    if (!condition || typeof condition.key !== 'string') return false;
    const current = values[condition.key];
    // A condition on a value nobody computed cannot be proven to hold, and
    // the field may not be asked at all.
    if (current === undefined) return false;
    if (condition.op === 'eq' && current !== condition.value) return false;
    if (condition.op === 'neq' && current === condition.value) return false;
    if (condition.op !== 'eq' && condition.op !== 'neq') return false;
  }
  return true;
}

/** The value for one field, or `undefined` when the service cannot compute it. */
function fieldValue(field, known) {
  const type = typeof field.type === 'string' ? field.type : 'string';
  // A link the user has to open cannot be answered from a service.
  if (type === 'external') return undefined;

  const kind = kindOfKey(field.key);
  if (kind) {
    const value = typedValue(type, known[kind]);
    if (value === undefined) return undefined;
    return optionsAllow(field, value) ? value : undefined;
  }

  // A choice with one option is unambiguous.
  if (Array.isArray(field.options) && field.options.length === 1) {
    const only = field.options[0];
    if (!only || typeof only.value !== 'string') return undefined;
    const value = typedValue(type, only.value);
    if (value === undefined) return undefined;
    return optionsAllow(field, value) ? value : undefined;
  }
  return undefined;
}

/** The known value a field key names, or `null`. */
function kindOfKey(key) {
  const normalized = normalizeKey(key);
  for (const kind of Object.keys(FIELD_KEYS)) {
    if (FIELD_KEYS[kind].indexOf(normalized) !== -1) return kind;
  }
  return null;
}

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The known value as the field's type, or `undefined` when it does not fit. */
function typedValue(type, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (type === 'string') return typeof raw === 'string' ? raw : undefined;
  if (type === 'number' || type === 'integer') {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  }
  if (type === 'boolean') return typeof raw === 'boolean' ? raw : undefined;
  if (type === 'multiselect') {
    const list = Array.isArray(raw) ? raw : [raw];
    const values = list.filter((v) => typeof v === 'string' && v !== '');
    return values.length ? values : undefined;
  }
  return undefined;
}

/** A choice field takes one of its option values, nothing else. */
function optionsAllow(field, value) {
  if (!Array.isArray(field.options) || !field.options.length) return true;
  const values = Array.isArray(value) ? value : [value];
  return values.every((v) => field.options.some((o) => o && o.value === v));
}
