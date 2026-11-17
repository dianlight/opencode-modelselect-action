'use strict';

/**
 * Minimal fake DOM — just enough for the panel bundle + the SDK UI kit.
 * Mirrors openchamber-modelselect/test/panel-frame.test.cjs.
 */

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
  prepend(...nodes) { for (let i = nodes.length - 1; i >= 0; i -= 1) this.appendChild(nodes[i]); return this; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  getBoundingClientRect() { return { width: 320, height: 24, left: 0, top: 0, right: 320, bottom: 24 }; }
  querySelector(sel) {
    const m = typeof sel === 'string' && sel.match(/\[data-id="([^"]+)"\]/);
    return findAll(this, (el) => (m ? el.dataset && el.dataset.id === m[1] : false))[0] || null;
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
  if (!caption) throw new Error(`no field labelled "${label}"`);
  const field = caption.parentNode;
  const input = (field.children || []).find((c) => hasClass(c, 'oc-sdk-input'));
  if (!input) throw new Error(`no input inside "${label}"`);
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
  if (!hit[0]) throw new Error(`no switch labelled "${label}"`);
  return hit[0];
}

function findButton(root, label) {
  const hit = findAll(root, (n) => hasClass(n, 'oc-sdk-btn') && textOf(n) === label);
  if (!hit[0]) throw new Error(`no button labelled "${label}"`);
  return hit[0];
}

function findTab(root, id) {
  const hit = findAll(root, (n) => n.attrs && n.attrs.role === 'tab' && n.dataset.id === id);
  if (!hit[0]) throw new Error(`no tab "${id}"`);
  return hit[0];
}

function fieldValue(root, label) {
  return fieldInput(root, label).value;
}

module.exports = { FakeElement, findAll, hasClass, textOf, fieldInput, setField, fieldValue, findSwitch, findButton, findTab };
