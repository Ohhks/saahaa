/* SAAHAA · ui/dom.js — the ONLY module that touches the DOM API.
   Everything else returns HTML strings. Swapping renderers later touches
   this file alone. */

import { icon } from './icons.js';

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** XSS boundary. Every value interpolated into a template goes through this. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/** Mount HTML into a slot, preserving focus, caret and scroll.
    Skips the write entirely when the markup is byte-identical — this is what
    stops a re-render from eating a half-typed search box. */
export function mount(slot, html) {
  const el = typeof slot === 'string' ? document.getElementById(slot) : slot;
  if (!el) return false;
  if (el.__html === html) return false;

  const active = document.activeElement;
  const inSlot = active && el.contains(active);
  const focusId = inSlot ? active.id : null;
  const selStart = inSlot && 'selectionStart' in active ? active.selectionStart : null;
  const selEnd   = inSlot && 'selectionEnd'   in active ? active.selectionEnd   : null;
  const scroll = el.scrollTop;

  el.innerHTML = html;
  el.__html = html;
  el.scrollTop = scroll;

  if (focusId) {
    const back = document.getElementById(focusId);
    if (back) {
      back.focus({ preventScroll: true });
      try { if (selStart != null) back.setSelectionRange(selStart, selEnd); } catch (e) {}
    }
  }
  return true;
}

/** One document-level delegated listener per event type. */
const delegated = new Set();
export function delegate(event, selector, handler) {
  if (!delegated.has(event)) {
    document.addEventListener(event, e => {
      for (const [sel, fns] of handlers.get(event) || []) {
        const hit = e.target.closest(sel);
        if (hit) fns.forEach(fn => fn(e, hit));
      }
    }, event === 'input' || event === 'change' ? true : false);
    delegated.add(event);
  }
  if (!handlers.has(event)) handlers.set(event, new Map());
  const m = handlers.get(event);
  if (!m.has(selector)) m.set(selector, []);
  m.get(selector).push(handler);
}
const handlers = new Map();

/** Wire every [data-act] click once. Actions register themselves — Open/Closed. */
const actions = new Map();
export function action(name, fn) { actions.set(name, fn); }
export function initActions() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions.get(el.dataset.act);
    if (!fn) return;
    e.preventDefault();
    try { fn(el.dataset, el, e); }
    catch (err) { console.error('[action]', el.dataset.act, err); toast('Something went wrong — ' + err.message); }
  });
}

/* ── toast ─────────────────────────────────────────────────── */
let toastEl = null, toastTimer = null;
export function toast(msg, tone = '') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  /* the tone is a CLASS, not an inline colour: tokens.css owns .toast.danger
     and .toast.warn, and only it knows what red means in each theme. */
  toastEl.className = `toast${tone ? ' ' + tone : ''}`;
  toastEl.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 3600);
}

/* A toast that STAYS until tapped — for "an update is ready". Built with
   createElement so nothing here is a string of markup. */
export function stickyToast(title, body, onTap) {
  const el = document.createElement('button');
  /* .toast--sticky is the token that moves it to the TOP of the screen — the
     bottom slot belongs to the tab bar, and this one waits for a tap. */
  el.className = 'toast toast--sticky on';
  el.setAttribute('role', 'status');
  el.style.cssText = 'pointer-events:auto;text-align:left';
  const b = document.createElement('b'); b.textContent = title;
  const s = document.createElement('span'); s.style.cssText = 'display:block;opacity:.85'; s.textContent = body;
  el.append(b, s);
  el.addEventListener('click', () => { el.remove(); if (onTap) onTap(); });
  document.body.appendChild(el);
  return el;
}

/* ── bottom sheet ──────────────────────────────────────────── */
let scrimEl = null, sheetEl = null, onClose = null, openRaf = 0;
export function sheet(title, bodyHtml, opts = {}) {
  if (!scrimEl) {
    scrimEl = document.createElement('div');
    scrimEl.className = 'scrim';
    scrimEl.addEventListener('click', closeSheet);
    document.body.appendChild(scrimEl);
    sheetEl = document.createElement('div');
    sheetEl.className = 'sheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    document.body.appendChild(sheetEl);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetEl.classList.contains('on')) closeSheet(); });
  }
  onClose = opts.onClose || null;
  /* The sheet's own header: title on the left, close on the right, a 2px rule
     under both. `shd` is kept for anything that looks it up; the flat system
     gives it no shadow. */
  sheetEl.innerHTML = `<div class="grab"></div>
    <div class="shd sheet__hd" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;box-shadow:none;border-bottom:2px solid var(--color-divider);margin-bottom:var(--sp-5)">
      <h3 style="margin-bottom:var(--sp-4)">${esc(title)}</h3>
      <button class="btn tap" data-act="sheet.close" aria-label="Close">${icon('cross', { size: 18 })}</button></div>
    <div class="sbody" style="padding:0">${bodyHtml}</div>`;
  // The open is deferred a frame for the slide-in. A close arriving inside
  // that frame used to be undone by the pending callback, re-opening a sheet
  // the app had already dismissed — so the handle is cancellable.
  cancelAnimationFrame(openRaf);
  openRaf = requestAnimationFrame(() => { scrimEl.classList.add('on'); sheetEl.classList.add('on'); });
  const first = sheetEl.querySelector('input,button,select,textarea');
  if (first && !opts.noFocus) setTimeout(() => first.focus({ preventScroll: true }), 340);
  return sheetEl;
}
export function updateSheet(bodyHtml) {
  if (sheetEl) mount(sheetEl.querySelector('.sbody'), bodyHtml);
}
export function closeSheet() {
  cancelAnimationFrame(openRaf); openRaf = 0;
  if (!sheetEl) return;
  scrimEl.classList.remove('on');
  sheetEl.classList.remove('on');
  if (onClose) { const f = onClose; onClose = null; f(); }
}
export const sheetOpen = () => !!(sheetEl && sheetEl.classList.contains('on'));

/* ── small formatters used by every view ───────────────────── */
export const stars = pct => `<span class="stars" aria-hidden="true">★★★★★<i style="--pct:${pct}%">★★★★★</i></span>`;
export const ratingStars = r => stars(Math.max(0, Math.min(100, (r / 5) * 100)));
export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
export const clockTime = ts => new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
