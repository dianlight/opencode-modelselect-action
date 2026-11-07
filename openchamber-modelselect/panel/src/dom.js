/* openchamber-modelselect — tiny DOM + style helpers for the settings panel.
 *
 * The SDK UI kit draws every control; these are the few pieces it does not
 * provide: the panel's own layout classes, a themed SVG icon set (Remixicon
 * outline shapes, 24x24, currentColor — never emoji), and the row shells of
 * the models tab.
 */

export function $(id) {
  return document.getElementById(id);
}

export function text(value) {
  return document.createTextNode(value == null ? '' : String(value));
}

export function noop() { /* best-effort host call */ }

export function el(tag, cls) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function toPromise(fn) {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

export function str(v) { return v == null ? '' : String(v); }

export function trim(v) { return str(v).trim(); }

export function roundCost(v) { return Math.round(v * 100) / 100; }

export function shallowCopy(obj) {
  var out = {};
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  }
  return out;
}

/** A section heading inside a tab. */
export function sectionTitle(container, title) {
  var h = el('div', 'mp-section');
  h.textContent = title;
  container.append(h);
}

var SVG_NS = 'http://www.w3.org/2000/svg';
var ICON_PATHS = {
  eye: 'M2 12s3.6-6.5 10-6.5S20.4 10 22 12s-3.6 6.5-10 6.5S3.6 14 2 12zm10 3.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-2a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  'eye-off': 'M2 12s3.6-6.5 10-6.5c1.2 0 2.3.2 3.3.5L13 3.7 14 2.6l2.5 2.5c2.4.9 4.1 2.4 5.5 4.4L22 12l-2 2.9c-1.4 2-3.1 3.5-5.5 4.4L12 21.8l-1-1.1-2.5-2.5c-1-.3-2.1-.5-3.3-.5C3.6 18.5 2 12 2 12zm10 3.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-2a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM4 4l16 16-1.4 1.4L2.6 5.4 4 4z',
  'file-text': 'M6 2h8l4 4v16H6V2zm7 1.5V7h3.5L13 3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2z',
  image: 'M4 4h16v16H4V4zm2 2v12h12V6H6zm2.7 2.3a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zM7 15l2.8-3.7 2.4 3 1.9-2.4L17.5 15H7z',
  'file-pdf': 'M6 2h8l4 4v16H6V2zm7 1.5V7h3.5L13 3.5zM8 12h8v6H8v-6z',
  audio: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a3 3 0 00-1.8-2.7v5.4a3 3 0 001.8-2.7zm-1.8-5.8v2a5 5 0 010 7.6v2a7 7 0 000-11.6z',
  video: 'M3 5h18v14H3V5zm2 2v10h14V7H5zm5 2l5 3-5 3v-6z',
  attachment: 'M20.6 13.4L13.4 20.6a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8zM7 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'
};

/**
 * Themed SVG icon. Same contract as the SDK's own helper (24x24,
 * currentColor) for the names the kit does not ship, and always carrying
 * `data-icon` so tests can assert without emoji.
 */
export function svgIcon(name, cls) {
  var svg = null;
  try {
    svg = document.createElementNS ? document.createElementNS(SVG_NS, 'svg') : document.createElement('span');
  } catch (e) {
    svg = document.createElement('span');
  }
  try {
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('data-icon', name);
    var d = ICON_PATHS[name];
    if (d) {
      var p = null;
      try {
        p = document.createElementNS ? document.createElementNS(SVG_NS, 'path') : document.createElement('span');
      } catch (e2) {
        p = document.createElement('span');
      }
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
  } catch (e) { /* icons are best-effort */ }
  return svg;
}

/** Input-modality icons for a chain row (unknown modalities render as text). */
export var MEDIA_TIPS = {
  text: 'Text input supported',
  image: 'Image input supported',
  pdf: 'PDF input supported',
  audio: 'Audio input supported',
  video: 'Video input supported',
  file: 'File input supported'
};
export var MEDIA_ICON_FOR = {
  text: 'file-text',
  image: 'image',
  pdf: 'file-pdf',
  audio: 'audio',
  video: 'video',
  file: 'attachment'
};

/**
 * The panel's own layout. Kit controls carry the host's look; only the
 * tab layout, the model cards and the cost slider need rules of their own,
 * and every colour is a host theme variable.
 */
export function mountStyles() {
  try {
    var style = el('style');
    style.textContent = [
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; background: transparent; color: var(--oc-fg); font: 12px/1.45 var(--oc-font); }',
      'body { padding: 8px 12px 12px; }',
      '.mp { display: flex; flex-direction: column; gap: 8px; }',
      '.mp-title { font-weight: 700; font-size: 13px; }',
      '.mp-note, .mp-file { font-size: 11px; color: var(--oc-muted); }',
      '.mp-section { margin-top: 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--oc-muted); }',
      '.mp-form { display: flex; flex-direction: column; gap: 8px; }',
      '.mp-foot { display: flex; justify-content: flex-end; padding-top: 8px; }',
      '.mp-cost { display: flex; flex-direction: column; gap: 4px; }',
      '.mp-cost-value { font-variant-numeric: tabular-nums; font-weight: 600; }',
      '.mp-cost-ticks { display: flex; justify-content: space-between; font-size: 10px; color: var(--oc-muted); }',
      '.mp-cost-tick-end { text-align: right; }',
      '.mp-mo-chain { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }',
      '.mp-mo-tools { display: flex; gap: 6px; align-items: flex-end; }',
      '.mp-mo-select { flex: 1 1 auto; min-width: 0; }',
      '.mp-mo-eye { flex: 0 0 auto; padding-bottom: 1px; }',
      '.mp-mo-pickline { font-weight: 600; font-size: 12px; }',
      '.mp-mo-empty { font-size: 11px; color: var(--oc-muted); }',
      '.mp-mo { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid var(--oc-border); border-radius: 6px; }',
      '.mp-mo.excluded { opacity: 0.55; }',
      '.mp-mo-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }',
      '.mp-mo-name { font-family: var(--oc-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.mp-mo-right { margin-left: auto; display: flex; gap: 4px; align-items: center; }',
      '.mp-mo-ico { display: inline-flex; line-height: 0; cursor: pointer; color: var(--oc-muted); }',
      '.mp-mo-ico svg { width: 14px; height: 14px; display: block; }',
      '.mp-mo-pick { flex: 0 0 auto; font-size: 10px; font-weight: 700; color: var(--oc-success-text); }',
      '.mp-mo-why { flex: 0 0 auto; font-size: 10px; color: var(--oc-muted); text-align: right; }',
      '.mp-mo-meta { font-size: 11px; color: var(--oc-muted); }',
      '.mp-mo-barwrap { display: flex; align-items: center; gap: 6px; }',
      '.mp-mo-bar { flex: 1 1 auto; height: 6px; border-radius: 3px; background: var(--oc-hover); overflow: hidden; }',
      '.mp-mo-fill { height: 100%; background: var(--oc-primary); }',
      '.mp-mo-fill.ok { background: var(--oc-success); }',
      '.mp-mo-fill.warn { background: var(--oc-warning); }',
      '.mp-mo-fill.err { background: var(--oc-error); }',
      '.mp-mo-fill.muted { background: var(--oc-muted); }',
      '.mp-mo-eyebtn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 7px; border: 1px solid var(--oc-border); border-radius: 6px; background: transparent; color: var(--oc-fg); cursor: pointer; }',
      '.mp-mo-eyebtn svg { width: 14px; height: 14px; display: block; }',
      '.mp-mo-barlabel { flex: 0 0 auto; font-size: 10px; font-variant-numeric: tabular-nums; color: var(--oc-muted); }',
      '.mp-mo-latch { font-size: 11px; color: var(--oc-warning-text); }'
    ].join('\n');
    document.head.append(style);
  } catch (e) { /* styles are best-effort */ }
}
