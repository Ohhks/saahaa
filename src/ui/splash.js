/* SAAHAA · ui/splash.js — "Welcome to SAAHAA".

   Panel decision V5-B1 (confidence 5): a full welcome screen once per session
   earns the brand moment; every later load in the same session gets a short
   flash instead, so the moment never decays into a daily tax.

   MODERNIST (v8): a light ground, the wordmark set in Archivo 800 as plain
   text, one red rule, the tagline in caps, the five pillars as bordered
   square icons, one primary CTA and a guest link, the credo at the foot.
   No gold, no gradient, no glow: the emblem is drawn small, in ink.

   The screen is INTERACTIVE from the first frame — the CTA takes taps before
   its own 700ms arrival finishes — and a returning visit flashes for ~740ms
   (brand.css owns the fade; this file only removes the node when it ends). */

import { mark, defs, PILLARS, pillarIcon } from './logo.js';
import { icon } from './icons.js';
import { VERSION } from '../core/version.js';
import * as flags from '../core/flags.js';

const SEEN_KEY = 'SAAHAA_SPLASH_SEEN';
const seenThisSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } };
const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {} };

export function shouldShow() { return flags.isOn('SPLASH'); }

/* logo.js paints in the gold gradient of the previous brand; the Modernist
   splash draws the same shapes in the current text colour instead, and
   brand.css sets that colour to ink. */
const inInk = svg => String(svg).replace(/url\(#gGold\)/g, 'currentColor');

/* (the inline background:none keeps tokens.css's dark-theme status-pill
   rule from painting the trust markers grey — a specificity tie it wins) */
const pillars = () => `<div class="pillars">${PILLARS.map(p => `
  <div class="pill" data-pillar="${p.id}" style="background:none">
    <span class="ic">${inInk(pillarIcon(p, 16))}</span>
    <span class="lbl">${p.label}</span>
  </div>`).join('')}</div>`;

/**
 * @param {object} o { onEnter, onGuest, force }
 * @returns {Promise<void>} resolves when the splash has left the DOM
 */
export function showSplash(o = {}) {
  return new Promise(resolve => {
    if (!shouldShow() && !o.force) return resolve();

    const flash = seenThisSession() && !o.force;
    const el = document.createElement('div');
    el.className = `splash ${flash ? 'splash--flash' : ''}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome to SAAHAA');

    el.innerHTML = `
      ${defs()}
      <span class="sp-ver">v${VERSION}</span>
      <div class="sp-inner">
        <div class="sp-mark" aria-hidden="true">${inInk(mark(72, { detail: true, animate: !flash, glow: false, core: true }))}</div>
        <div class="sp-wm">SAAHAA</div>
        <div class="sp-rule" aria-hidden="true"><i></i><b></b><i></i></div>
        <div class="sp-tag">Together, we elevate life</div>
        ${flash ? '' : `<p class="sp-what">Book a plumber, an electrician or a cleaner near you —
          and order from the shops on your own street. One app, one neighbourhood.</p>`}
        ${flash ? '' : pillars()}
        ${flash ? '' : `
          <button class="btn btn--primary btn--lg btn--block sp-cta" data-sp="enter">
            Welcome to SAAHAA ${icon('forward', { size: 18 })}
          </button>
          <button class="sp-guest" data-sp="guest">Look around first</button>`}
      </div>
      <div class="sp-credo">One circle. One purpose.</div>`;

    document.body.appendChild(el);
    markSeen();

    let done = false;
    const finish = which => {
      if (done) return; done = true;
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(which); }, 240);
      if (which === 'enter' && o.onEnter) o.onEnter();
      if (which === 'guest' && o.onGuest) o.onGuest();
    };

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-sp]');
      if (b) finish(b.dataset.sp);
      else if (flash) finish('flash');
    });

    if (flash) setTimeout(() => finish('flash'), 740);
    else {
      // never trap the user: auto-advance after 6s of no input
      setTimeout(() => finish('idle'), 6000);
      document.addEventListener('keydown', function k(e) {
        if (e.key === 'Enter' || e.key === 'Escape') { document.removeEventListener('keydown', k); finish('enter'); }
      });
    }
  });
}

export function replaySplash() { return showSplash({ force: true }); }
