/* SAAHAA · ui/splash.js — "Welcome to SAAHAA".

   Panel decision V5-B1 (confidence 5): a full welcome screen once per session
   earns the brand moment; every later load in the same session gets a 900ms
   flash instead, so the moment never decays into a daily tax.

   The screen is INTERACTIVE from 900ms even though it keeps settling to
   ~2050ms — the CTA takes taps before its own animation finishes. */

import { mark, defs, pillarRow } from './logo.js';
import { VERSION } from '../core/version.js';
import * as flags from '../core/flags.js';

const SEEN_KEY = 'SAAHAA_SPLASH_SEEN';
const seenThisSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; } };
const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {} };

export function shouldShow() { return flags.isOn('SPLASH'); }

/**
 * @param {object} o { onEnter, onGuest, force }
 * @returns {Promise<void>} resolves when the splash has left the DOM
 */
export function showSplash(o = {}) {
  return new Promise(resolve => {
    if (!shouldShow() && !o.force) return resolve();

    const flash = seenThisSession() && !o.force;
    const el = document.createElement('div');
    el.className = `splash on-plum ${flash ? 'splash--flash' : ''}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome to SAAHAA');

    el.innerHTML = `
      ${defs()}
      <span class="sp-ver">v${VERSION}</span>
      <div class="sp-inner">
        <div class="sp-mark">${mark(flash ? 140 : 220, { detail: true, animate: !flash, glow: true })}</div>
        <div class="sp-wm">SAAHAA</div>
        <div class="sp-rule"><i></i><b></b><i></i></div>
        <div class="sp-tag">Together, we elevate life</div>
        ${flash ? '' : pillarRow()}
        ${flash ? '' : `
          <button class="btn btn--primary btn--lg btn--block sp-cta" data-sp="enter">
            Welcome to SAAHAA &nbsp;→
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
      setTimeout(() => { el.remove(); resolve(which); }, 340);
      if (which === 'enter' && o.onEnter) o.onEnter();
      if (which === 'guest' && o.onGuest) o.onGuest();
    };

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-sp]');
      if (b) finish(b.dataset.sp);
      else if (flash) finish('flash');
    });

    if (flash) setTimeout(() => finish('flash'), 900);
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
