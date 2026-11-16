'use strict';

/**
 * Provider catalog — shared pure decision core (no dependencies).
 *
 * Vendored into `github-action/src/shared/core/` and
 * `plugin/src/shared/core/` by `scripts/build-core.js`; edit `core/`,
 * never the vendored copies.
 *
 * The catalog is written by `scripts/opencode_maintenance.py`
 * (`data/provider-catalog.json`) and is deliberately key-agnostic: it
 * carries WHAT a model is and WHAT it costs, never whether the caller may
 * use it (enabled/credit/budget stay runtime concerns).
 *
 * One row per `(provider, model)`:
 *   { provider, id, canonical, name?, class?, free?,
 *     input_cost, output_cost, blended_cost, context, media_in, media_out }
 *
 * `provider` is a stable slug (the OpenCode provider id for the two engine
 * providers, the vendor slug — the live catalog's `canonical` field — for
 * console connections), so a catalog row joins the live inventory of any
 * account without committing baseURLs, headers, connection ids or org ids.
 */

// Tier/config suffixes that do not change the underlying model (mirrors
// `_canonical_model_base` in scripts/opencode_maintenance.py).
const VARIANT_SUFFIXES = ['contributor', 'unlimited', 'free'];
const EFFORT_SUFFIXES = [
  'max-effort',
  'high-effort',
  'medium-effort',
  'low-effort',
  'xhigh',
  'high',
  'medium',
  'low',
  'max',
];
const NX_SUFFIX_RE = /-(\d+)x$/;
const DATE_SUFFIX_RES = [/-(\d{4}-\d{2}-\d{2})$/, /-(\d{8})$/];

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Lowercase, drop the provider prefix, turn version dots into dashes. */
function bareModelName(value) {
  let name = String(value == null ? '' : value).trim().toLowerCase();
  if (name.includes('/') && !name.startsWith('http')) name = name.slice(name.lastIndexOf('/') + 1);
  return name.replace(/\./g, '-');
}

/**
 * Reduce a model id to the identity shared by every provider that serves
 * it: `opencode/muse-spark-1.3-contributor-free`, `muse-spark-1.3-xhigh`,
 * `openrouter/gemini-4-argon:free` and `anthropic/claude-opus-4.6` all
 * collapse to a stable base. Tier/effort suffixes are stripped with either
 * a `-` or `:` separator so provider aliases like `provider/modello:free`
 * join the same canonical as `opencode/modello-free`.
 */
function canonicalModel(value) {
  let name = bareModelName(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of VARIANT_SUFFIXES.concat(EFFORT_SUFFIXES)) {
      for (const sep of ["-", ":"]) {
        const token = `${sep}${suffix}`;
        if (name.endsWith(token) && name.length > token.length) {
          name = name.slice(0, -token.length);
          changed = true;
          break;
        }
      }
      if (changed) continue;
    }
    if (changed) continue;
    const nx = NX_SUFFIX_RE.exec(name);
    if (nx && name.slice(0, nx.index)) {
      name = name.slice(0, nx.index);
      changed = true;
      continue;
    }
    for (const rx of DATE_SUFFIX_RES) {
      if (rx.test(name)) {
        name = name.replace(rx, '');
        changed = true;
        break;
      }
    }
  }
  return name;
}

/** Provider slug of a catalog row (or live inventory entry). */
function providerSlug(row) {
  if (!isObject(row)) return '';
  const provider = String(row.provider == null ? '' : row.provider).trim().toLowerCase();
  if (provider) return provider;
  const canonical = String(row.canonical == null ? '' : row.canonical).trim().toLowerCase();
  if (canonical) return canonical;
  return String(row.providerID ?? '').trim().toLowerCase();
}

/** Stable `provider/id` key for latch files and log lines. */
function rowKey(row) {
  if (!isObject(row)) return '';
  const provider = String(row.provider ?? row.providerID ?? '').trim();
  const id = String(row.id ?? row.modelID ?? '').trim();
  return provider && id ? `${provider}/${id}` : '';
}

function knownCost(value) {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Cost class of a row:
 *   free     — zero blended cost (any provider, including Go free tiers)
 *   go-plan  — paid model served by the Go subscription
 *   zen-paid — paid model billed to the Zen balance
 *   external — any other provider
 */
function classOf(row) {
  if (!isObject(row)) return 'external';
  if (row.free === true) return 'free';
  const cost = knownCost(row.blended_cost);
  if (cost === 0) return 'free';
  const provider = String(row.provider ?? row.providerID ?? '').trim().toLowerCase();
  if (provider === 'opencode-go') return 'go-plan';
  if (provider === 'opencode') return 'zen-paid';
  return 'external';
}

/** Catalog rows, accepting both the file shape and a bare array. */
function catalogRows(catalog) {
  if (Array.isArray(catalog)) return catalog.filter(isObject);
  if (!isObject(catalog)) return [];
  if (Array.isArray(catalog.models)) return catalog.models.filter(isObject);
  return [];
}

/**
 * Index the catalog by canonical model id.
 * Rows are normalized (provider slug, canonical, class, numeric costs)
 * so consumers never re-derive them.
 */
function indexCatalog(catalog) {
  const index = new Map();
  for (const row of catalogRows(catalog)) {
    const id = String(row.id ?? row.modelID ?? '').trim();
    const provider = providerSlug(row);
    if (!id || !provider) continue;
    const canonical = canonicalModel(row.canonical || id);
    const normalized = {
      provider,
      id,
      canonical,
      name: row.name ?? id,
      input_cost: knownCost(row.input_cost),
      output_cost: knownCost(row.output_cost),
      blended_cost: knownCost(row.blended_cost),
      context: knownCost(row.context),
      media_in: Array.isArray(row.media_in) ? row.media_in.slice() : null,
      media_out: Array.isArray(row.media_out) ? row.media_out.slice() : null,
    };
    normalized.class = classOf(normalized);
    normalized.free = normalized.class === 'free';
    normalized.key = rowKey(normalized);
    if (!index.has(canonical)) index.set(canonical, []);
    index.get(canonical).push(normalized);
  }
  return index;
}

/** All rows for one model reference (`provider/id` or a bare id). */
function rowsForModel(index, model) {
  if (!index || !index.size) return [];
  const raw = String(model == null ? '' : model).trim();
  if (!raw) return [];
  const direct = index.get(raw.toLowerCase());
  if (direct) return direct;
  const canonical = canonicalModel(raw);
  if (!canonical) return [];
  if (index.has(canonical)) return index.get(canonical);
  // Fall back to a canonical match when the id carries extra suffixes
  // the ranker kept (e.g. a dated snapshot).
  const out = [];
  for (const [key, rows] of index) {
    if (key === canonical || key.endsWith(`-${canonical}`) || canonical.endsWith(`-${key}`)) {
      out.push(...rows);
    }
  }
  return out;
}

module.exports = {
  bareModelName,
  canonicalModel,
  providerSlug,
  rowKey,
  classOf,
  catalogRows,
  indexCatalog,
  rowsForModel,
};
