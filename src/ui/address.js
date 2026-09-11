/* SAAHAA · ui/address.js — where, exactly.

   AN AREA IS NOT AN ADDRESS, AND THE GROCERY CART NEVER ASKED FOR ONE.
   The service sheet learned this in 8.6.0 and grew two fields. The cart did
   not, so a ₹521 basket of rice shipped with `customerAddress: ""` and the
   rider was handed "Madhapur" and a pin on a neighbourhood centroid. The order
   screen then printed "This booking was taken before addresses were collected"
   — a false sentence, on an order placed thirty seconds earlier — because that
   fallback cannot tell an old order from one the cart simply never asked.

   The account screen's own setting is labelled **Addresses** and opens a map
   with one input: "Search a place — area, town or city". There was nowhere in
   the entire product for a customer to type a flat number.

   Two screens asking the same question is two chances to drift, and they had
   already drifted. So the question lives here, once, and both ask it. */

import { esc } from './dom.js';
import { t } from './i18n.js';
import { me, dispatch, saveSession } from '../core/ctx.js';

/** The two inputs, pre-filled from the account — a person types their own door
    number once. Renders nothing for a guest, who has no account to save to. */
export function addressFields({ required = true } = {}) {
  const u = me();
  if (!u) return '';
  return `
    <div class="field" style="margin:2px 0 8px">
      <input id="bkAddr" autocomplete="street-address" placeholder=" " maxlength="240"
        ${required ? 'required aria-required="true"' : ''} value="${esc(u.address || '')}">
      <label>${esc(t('addr.street'))}${required ? '' : ' (optional)'}</label></div>
    <div class="field" style="margin:0 0 12px">
      <input id="bkMark" autocomplete="off" placeholder=" " maxlength="120"
        value="${esc(u.landmark || '')}">
      <label>${esc(t('addr.landmark'))}</label></div>`;
}

/* A FIELD THAT IS NOT ON THE SCREEN HAS SAID NOTHING. Reading these
   unconditionally once wiped a saved address to the empty string, on the
   account and the session, because the "Someone else" path books from a row
   that renders no inputs. Only a field that exists may change what is stored. */
export function saveAddress() {
  const el = id => (typeof document === 'undefined' ? null : document.getElementById(id));
  const u = me();
  if (!u || !el('bkAddr')) return null;
  const address = (el('bkAddr').value || '').trim();
  const landmark = ((el('bkMark') || {}).value || '').trim();
  if (address === (u.address || '') && landmark === (u.landmark || '')) return { address, landmark };
  dispatch({ type: 'user/patch', payload: { key: u.key, patch: { address, landmark } } });
  saveSession({ ...u, address, landmark });
  return { address, landmark };
}

/** Enough of an address to send somebody to a door. Deliberately forgiving —
    "302, Sai Nilayam" is an address and "Madhapur" is not — because the cost of
    rejecting a real one is a customer who gives up at checkout. */
export const looksLikeAddress = s => String(s || '').trim().length >= 6;

/** Whether this delivery mode needs one at all. A pickup order is collected by
    the customer, so demanding her door number to hand her a bag is a wall for
    no reason. */
export const modeNeedsAddress = mode => mode !== 'pickup';
