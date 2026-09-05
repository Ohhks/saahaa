/* SAAHAA · core/update.js — continuous delivery without a maintenance window.

   A deploy is a new set of files under the same URL. Nothing about that has
   to interrupt anyone: the running page keeps working on the build it loaded,
   and this module simply notices that a newer build exists and offers it —
   one tap, one reload, no "we'll be back at 3am".

   HOW IT KNOWS. The build writes dist/version.json ({version, build, at}).
   We poll it — cheaply, no-store — every few minutes and when the page is
   brought back to the foreground. A different `build` means "an update is
   waiting". We never force it mid-task: a pro half-way through an OTP entry
   must not have the screen yanked away. The prompt is a toast that stays
   until tapped, and a reload is safe at any time because state lives in
   localStorage and every migration is idempotent (core/migrate.js).

   WHY THIS IS ENOUGH FOR ZERO-DOWNTIME. GitHub Pages serves each build as a
   single inlined file plus a hash-stamped shell; the service worker's cache
   is named by BUILD_ID, so an old shell can never be paired with new modules.
   The database migrations that ship with a build run at boot, forwards only,
   with a snapshot and an automatic rollback on failure. So: push → CI → deploy
   → users pick it up on their next natural reload or on this prompt. No
   maintenance period exists in this model because nothing is ever "down". */

import { BUILD_ID, VERSION } from './version.js';

const POLL_MS = 5 * 60e3;
let timer = null, offered = false, latest = null;

async function check() {
  try {
    const r = await fetch(`version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    latest = v;
    if (v && v.build && v.build !== BUILD_ID) offer(v);
    return v;
  } catch (e) { return null; }
}

let onUpdate = null;
function offer(v) {
  if (offered) return;
  offered = true;
  // core never touches the DOM: the shell decides how to show it
  if (onUpdate) onUpdate(v, () => location.reload());
}

/** @param {(v:object, apply:Function)=>void} show  how to present the offer */
export function startUpdateWatch(show) {
  onUpdate = show || null;
  if (timer) return;
  timer = setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  // the first check is deferred so it never competes with boot
  setTimeout(check, 20e3);
}
export const currentBuild = () => ({ version: VERSION, build: BUILD_ID, latest });
