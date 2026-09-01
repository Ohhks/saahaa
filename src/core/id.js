/* SAAHAA · core/id.js — collision-free, mesh-safe ids. Single responsibility. */
const DEVICE = (() => {
  try {
    let d = localStorage.getItem('SAAHAA_DEVICE');
    if (!d) { d = Math.random().toString(36).slice(2, 8); localStorage.setItem('SAAHAA_DEVICE', d); }
    return d;
  } catch (e) { return Math.random().toString(36).slice(2, 8); }
})();

let seq = 0;
export const deviceId = () => DEVICE;
export function nid(prefix = 'id') { return `${prefix}_${DEVICE}${(seq++).toString(36)}${Date.now().toString(36).slice(-5)}`; }
export function otp() { return String(Math.floor(1000 + Math.random() * 9000)); }
