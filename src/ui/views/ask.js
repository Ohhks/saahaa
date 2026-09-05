/* SAAHAA · ui/views/ask.js — "Ask rates", the customer face of the P2P auction.

   THE WORD IS "RATE", NEVER "BID". Every Hyderabad customer already asks three
   vegetable stalls before buying; nobody needs that explained. "Bid" and
   "auction" imply the customer might LOSE something, and the entire adoption
   story is that they cannot. So: a bid is a "rate", a bidder is a "worker",
   the set of them is "replies", and the locked match is the "held price".
   The words bid / auction / P2P / cheapest / negotiate appear nowhere on screen.

   THREE RULES CARRY THE WHOLE FEATURE:

     1. THE HELD PRICE NEVER MOVES. The original locked match stays reserved
        for the entire window. Asking cannot cost the customer anything — and
        because it cannot, they will try it once. That is the conversion
        mechanism; it is not education, it is downside elimination.
     2. THE FIRST REPLY IS NEVER ZERO. At 8 seconds the held price appears as
        reply one — truthfully that pro's own rate. The customer never sees an
        empty screen, and the frame is "everything after this is upside".
     3. NEVER SORT BY PRICE, NEVER PROMISE CHEAPEST. The score peaks at the
        fair price. A UI that promises "cheapest" is lying about its own
        mechanism, and customers who pick badly on that promise blame us. */

import { ctx, getState, me, isGuest } from '../../core/ctx.js';
import * as M from '../../core/money.js';
import { esc, sheet, closeSheet, toast, ratingStars } from '../dom.js';
import { get } from '../../core/registry.js';
import * as A from '../../domain/auction.js';
import { budgetChips, priceScore } from '../../domain/bidding.js';
import { quoteService } from '../../domain/pricing.js';

/* Workers bid the DEAL — their own rate, which they keep 100% of. The
   customer is charged the deal plus the platform's 10%. Showing the customer
   a worker's raw rate while charging them the all-in total made every saving
   figure on this screen wrong: it promised a Rs.66 saving on a booking that
   actually saved Rs.23. Every customer-facing number here is what they PAY;
   every worker-facing number is what he EARNS. Never mix the two. */
const pay = deal => quoteService(deal).customerPays;
const payGap = deal => Math.round(deal * 1.10);

/* ── the live clock ───────────────────────────────────────────
   One interval for the whole module. A screen that stops moving while workers
   are still replying reads as a hung app. */
let tick = null;
function beat(on) {
  if (on && !tick) tick = setInterval(() => { if (ctx.view === 'ask') ctx.render(); else beat(false); }, 1000);
  if (!on && tick) { clearInterval(tick); tick = null; }
}

/* real stars from real ratings — never a rescaled score component dressed up
   as a rating on the most trust-loaded card in the feature */
function avgOf(partnerId) {
  const p = getState().partners.find(x => x.id === partnerId);
  const r = (p && p.ratings) || [];
  return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 4.2;
}
const mmss = ms => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const avatar = (name, size = 40, dim = false) => `
  <span style="width:${size}px;height:${size}px;border-radius:50%;flex:0 0 auto;display:grid;
    place-items:center;font-weight:800;font-size:${Math.round(size / 2.6)}px;
    background:${dim ? 'var(--surface-2)' : 'var(--accent-fill)'};
    color:${dim ? 'var(--muted)' : 'var(--accent-on-fill)'};
    ${dim ? 'opacity:.55' : ''}">${esc((name || '?')[0])}</span>`;

/* ── entry point: the row under Confirm ────────────────────────
   BELOW the Confirm button, never above, never a modal, never an
   interstitial. The three-tap fast path stays visually first; this is an
   alternative to Confirm sitting where the thumb already is. */
export function entryRow(catId, partner, heldAmount) {
  const o = A.askOffer(catId, heldAmount);
  if (!o.show) return '';
  const done = asksCompleted();
  const mine = lastSaving();
  // Personal beats population, always. Their own rupees from last time.
  const lead = mine ? `Last time you saved ${M.fmt(payGap(mine))} by asking.`
                    : `People here paid about ${M.fmt(payGap(o.est))} less.`;
  return `
  <div style="display:flex;align-items:center;gap:10px;margin:14px 0 10px">
    <span class="rule grow"></span><span class="micro muted">or</span><span class="rule grow"></span>
  </div>
  <button class="btn btn--secondary btn--block" style="text-align:left;padding:13px 15px;height:auto"
          data-act="ask.start" data-id="${catId}" data-pid="${partner.id}" data-held="${heldAmount}">
    <b style="font-size:15px">Ask rates from ${A.MAX_INVITES > 4 ? 4 : A.MAX_INVITES} more workers</b>
    <span class="tiny muted" style="display:block;margin-top:3px;font-weight:500;white-space:normal">
      ${esc(lead)}${done < 2 ? ` Takes ${o.mins} min. Your ${M.fmt(pay(heldAmount))} stays held.` : ''}
    </span>
  </button>`;
}

export function asksCompleted() {
  return A.myRequests().filter(r => r.status === 'awarded' || r.status === 'held_booked').length;
}
function lastSaving() {
  const r = A.myRequests().find(x => x.status === 'awarded' && x.savedPaise > 0);
  return r ? r.savedPaise : 0;
}

/* ── start ─────────────────────────────────────────────────── */
export function startAsk(catId, partnerId, heldAmount) {
  if (isGuest()) { toast('Sign in first'); ctx.go('auth'); return; }
  const p = getState().partners.find(x => x.id === partnerId);
  if (!p) return;
  const req = A.postRequest({
    catId, slotType: 'now',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount },
  });
  if (!req) return;
  closeSheet();
  ctx.go('ask', req.id);
}

/* ── the screen ────────────────────────────────────────────── */
export function render(requestId) {
  const req = A.requestById(requestId);
  if (!req) { beat(false); return shell('Ask rates', `<div class="empty"><h3>That request is gone</h3>
    <p>It may have expired. Nothing was charged.</p>
    <button class="btn btn--primary" data-act="nav.home">Back to home</button></div>`); }

  A.closeIfDue(requestId);
  const live = A.requestById(requestId);
  if (live.status === 'bidding') { beat(true); return waiting(live); }
  beat(false);
  if (live.status === 'awaiting_choice') { beat(true); return choosing(live); }
  if (live.status === 'no_bids') return noBids(live);
  return shell('Ask rates', `<div class="card"><b>This request is closed.</b>
    <p class="tiny muted" style="margin-top:6px">Nothing was charged.</p>
    <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="nav.orders">Your orders</button></div>`);
}

function shell(title, body) {
  return `<header class="hdr on-plum" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
      <div class="wrap inner">
        <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back">←</button>
        <div class="grow"><b style="font-size:17px;display:block">${esc(title)}</b></div>
      </div></header>
    <main class="wrap" style="padding-bottom:120px">${body}</main>`;
}

/* ── waiting ───────────────────────────────────────────────────
   For the first 30 seconds this screen's only job is to prove that humans are
   moving — named, photographed workers, not a spinner. After 30 seconds its
   job changes completely: let the customer LEAVE safely. Retention is not
   "keep them staring for twelve minutes", which is impossible. It is "make
   leaving safe and coming back automatic". */
function waiting(req) {
  const cat = get('category', req.catId);
  const now = Date.now();
  const elapsed = now - req.openedAt;
  const total = req.closesAt - req.openedAt;
  const bids = A.bidsFor(req.id).slice().sort((a, b) => a.submittedAt - b.submittedAt);
  const pool = A.poolSize(req.catId);
  const invited = Math.min(A.MAX_INVITES, 4 * (Math.floor(elapsed / 180000) + 1), pool);
  const heldShown = elapsed >= 8000;
  const replies = bids.length + (heldShown ? 1 : 0);

  const dots = Array.from({ length: 4 }, (_, i) => {
    const lit = elapsed > 2000 + i * 1500;
    const nm = (req.held && i === 0) ? req.held.partnerName : ['Sattar', 'Prakash', 'Venu', 'Imran'][i] || '·';
    return `<div style="text-align:center;flex:1">
      ${avatar(nm, 44, !lit)}
      <p class="micro ${lit ? '' : 'muted'}" style="margin-top:5px">${lit ? esc(nm.split(' ')[0]) : '···'}</p>
    </div>`;
  }).join('');

  const cards = [];
  if (heldShown && req.held) cards.push(replyCard({
    name: req.held.partnerName, amount: req.held.amount, held: true,
  }));
  bids.forEach(b => cards.push(replyCard({ name: b.partnerName, amount: b.amount, held: false, held0: req.held && req.held.amount })));

  return shell(cat.name, `
    <!-- persistent furniture: this strip and the line below it prevent the two
         panics — "did it take my money?" and "does 12 minutes mean he arrives
         in 12 minutes?" Neither may ever scroll off screen. -->
    <div class="card" style="margin-top:12px;border-color:var(--ok);padding:12px 14px">
      <div class="between">
        <div><span class="tiny muted">Your held price</span>
          <div class="num" style="font-size:20px;font-weight:800">${M.fmt(pay(req.held ? req.held.amount : req.target))}</div></div>
        <span class="badge badge--ok">Safe</span>
      </div>
      <p class="micro muted" style="margin-top:6px">Not charged yet. Your worker comes as planned.</p>
    </div>

    <h2 style="margin:20px 0 4px;font-size:20px">Asking ${invited} workers near you</h2>
    <p class="tiny muted" style="margin-bottom:14px">
      ${replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Most people get 3 rates in about 4 minutes.'}
    </p>

    <div class="row" style="gap:4px;margin-bottom:18px">${dots}</div>

    <!-- elapsed counts UP with a marker at "usually done". A 12:00 countdown
         reads as a twelve-minute wall and drives people straight out. -->
    <div style="height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden;position:relative">
      <i style="display:block;height:100%;width:${Math.min(100, (elapsed / total) * 100).toFixed(1)}%;
        background:var(--accent-fill);border-radius:99px"></i>
      <i style="position:absolute;left:33%;top:-3px;width:2px;height:14px;background:var(--muted);opacity:.5"></i>
    </div>
    <div class="between" style="margin:6px 0 20px">
      <span class="micro muted">${mmss(elapsed)} elapsed</span>
      <span class="micro muted">usually done by 4:00</span>
    </div>

    ${cards.join('')}

    ${elapsed > 30000 ? `<button class="btn btn--ghost btn--block" style="margin-top:14px"
        data-act="ask.background" data-id="${req.id}">Close the app. We'll message you.</button>` : ''}

    <p class="micro muted" style="margin-top:18px;text-align:center">
      If you don't pick, your ${M.fmt(pay(req.held ? req.held.amount : req.target))} booking stays. Nothing is lost.</p>

    ${bottomBar(req)}`);
}

function replyCard({ name, amount, held, held0 }) {
  const less = held0 && amount < held0 ? held0 - amount : 0;
  return `<div class="card" style="margin-bottom:8px;padding:12px 14px;${held ? 'border-color:var(--ok)' : ''}">
    <div class="row">
      ${avatar(name, 38)}
      <div class="grow"><b>${esc(name)}</b>
        ${less ? `<p class="micro" style="color:var(--ok);margin-top:2px">${M.fmt(payGap(less))} less than held</p>` : ''}</div>
      <div style="text-align:right">
        <b class="num" style="font-size:18px">${M.fmt(pay(amount))}</b>
        ${held ? `<p class="micro"><span class="badge badge--ok">Already yours</span></p>` : ''}
      </div>
    </div></div>`;
}

/* Both escapes are one tap and neither asks "are you sure". A customer who has
   to argue with a dialog to get out will not come back in. */
function bottomBar(req) {
  const held = req.held ? req.held.amount : null;
  return `<div style="position:sticky;bottom:76px;display:flex;gap:8px;padding:10px 0 0;
      background:linear-gradient(transparent,var(--bg) 34%)">
    ${held ? `<button class="btn btn--primary grow" data-act="ask.held" data-id="${req.id}">
      Book ${M.fmt(pay(held))} now</button>` : ''}
    <button class="btn btn--ghost" data-act="ask.cancel" data-id="${req.id}">Cancel — nothing charged</button>
  </div>`;
}

/* ── choosing ──────────────────────────────────────────────────
   Sorted by score. NEVER by price, and with no price sort available. The
   cheapest reply is always shown, always bookable, and always carries one
   honest sentence naming what it costs in rating and arrival time — hiding it
   would be the fastest possible way to lose trust in a market where people
   compare notes. It gets a grey chip, not a gold badge. */
function choosing(req) {
  const r = A.ranked(req.id);
  const held = req.held ? req.held.amount : null;
  const msLeft = (req.holdUntil || 0) - Date.now();
  if (!r.hero) return noBids(req);

  const showCounter = asksCompleted() >= 2;      // hidden for first-timers on purpose
  const cards = [];
  cards.push(heroReply(req, r.hero, held, showCounter));
  r.others.forEach(b => cards.push(otherReply(req, b, r.hero, r.cheapest, held)));

  return shell('Rates are in', `
    <h2 style="margin:16px 0 2px;font-size:21px">${r.all.length} workers replied</h2>
    <p class="tiny muted">Your held price was ${M.fmt(pay(held || req.target))} ·
      <b style="color:var(--warn)">${mmss(msLeft)} to pick</b></p>
    <div style="margin-top:16px">${cards.join('')}</div>
    ${held ? `<div class="card" style="opacity:.72;padding:12px 14px">
      <div class="row">${avatar(req.held.partnerName, 34, true)}
        <div class="grow"><b class="tiny">${esc(req.held.partnerName)}</b>
          <p class="micro muted">Your held price · first match</p></div>
        <button class="btn btn--ghost btn--sm" data-act="ask.held" data-id="${req.id}">${M.fmt(pay(held))}</button>
      </div></div>` : ''}
    <p class="micro muted" style="margin-top:16px;text-align:center">
      Nothing is charged until the work is done.</p>`);
}

function heroReply(req, b, held, showCounter) {
  const less = held && b.amount < held ? held - b.amount : 0;
  const c = showCounter ? A.counterFor(req.id, b.id) : { available: false };
  const pending = b.status === 'countered';
  return `<div class="card" style="border-color:var(--ok);border-width:2px;padding:16px;margin-bottom:12px">
    <span class="badge badge--gold">Best pick</span>
    <div class="row" style="margin-top:10px">
      ${avatar(b.partnerName, 44)}
      <div class="grow"><b style="font-size:16px">${esc(b.partnerName)}</b>
        <p class="tiny muted">${ratingStars(avgOf(b.partnerId))} · ${b.km} km · ${esc((b.band && b.band.label) || 'Verified')}</p></div>
    </div>
    <div style="text-align:center;margin:14px 0 6px">
      <div class="num" style="font-size:34px;font-weight:800;line-height:1">${M.fmt(pay(b.amount))}</div>
      ${less ? `<p class="tiny" style="color:var(--ok);margin-top:4px;font-weight:700">
        ${M.fmt(payGap(less))} less than held</p>` : `<p class="tiny muted" style="margin-top:4px">Fair price</p>`}
    </div>
    <p class="tiny muted" style="text-align:center;margin-bottom:14px">${esc(whyLine(b))}</p>
    <button class="btn btn--primary btn--lg btn--block" data-act="ask.accept"
            data-id="${req.id}" data-bid="${b.id}">Book ${M.fmt(pay(b.amount))}</button>
    ${pending ? `<p class="micro muted" style="text-align:center;margin-top:8px">
        Asked. If he says no, ${M.fmt(pay(b.amount))} is still yours.</p>`
      : c.available ? `<button class="btn btn--ghost btn--sm btn--block" style="margin-top:8px"
        data-act="ask.counter" data-id="${req.id}" data-bid="${b.id}">
        Ask if he can do ${M.fmt(pay(c.amount))}?</button>` : ''}
  </div>`;
}

function otherReply(req, b, hero, cheapest, held) {
  const isCheapest = cheapest && b.id === cheapest.id && cheapest.id !== hero.id;
  const gap = isCheapest ? hero.amount - b.amount : 0;
  return `<div class="card" style="padding:14px;margin-bottom:10px">
    <div class="row">
      ${avatar(b.partnerName, 38)}
      <div class="grow"><b>${esc(b.partnerName)}</b>
        <p class="micro muted">${b.km} km · ~${b.eta} min</p></div>
      <div style="text-align:right"><b class="num" style="font-size:19px">${M.fmt(pay(b.amount))}</b>
        ${isCheapest ? `<p class="micro"><span class="badge badge--soft">Lowest price</span></p>` : ''}</div>
    </div>
    ${isCheapest && gap > 0 ? `<p class="micro muted" style="margin-top:8px">
      ${M.fmt(payGap(gap))} cheaper, but ${esc(tradeoff(b, hero))}.</p>` : ''}
    <button class="btn btn--ghost btn--block btn--sm" style="margin-top:10px"
            data-act="ask.accept" data-id="${req.id}" data-bid="${b.id}"
            data-warn="${lowRated(b, hero) ? '1' : ''}">Book ${M.fmt(pay(b.amount))}</button>
  </div>`;
}

/* Exactly two reasons, in fixed plain phrasings. Never a percentage, never a
   "score", never the word algorithm. */
function whyLine(b) {
  const bits = [];
  if (b.parts.price > 0.9) bits.push('fair price');
  if (b.parts.rating > 0.75) bits.push('best rating');
  if (b.parts.distance > 0.6) bits.push(`${b.eta} min away`);
  if (b.parts.trust > 0.7) bits.push('most trusted');
  if (!bits.length) bits.push('best overall');
  return bits.slice(0, 3).join(', ') + '.';
}
function tradeoff(b, hero) {
  const out = [];
  if (b.parts.rating < hero.parts.rating - 0.08) out.push('rated lower');
  if (b.km > hero.km + 1) out.push(`${b.eta} min away`);
  if (b.trust < hero.trust - 5) out.push('less trusted');
  return out.slice(0, 2).join(' and ') || 'newer to SAAHAA';
}
const lowRated = (b, hero) => (hero.parts.rating - b.parts.rating) > 0.24;

/* ── nobody beat it ────────────────────────────────────────────
   A failed ask is framed as a CONFIRMED GOOD PRICE, not a broken feature.
   This screen is the difference between a customer who tries again and one
   who never touches the button a second time. */
function noBids(req) {
  const held = req.held ? req.held.amount : null;
  return shell('Rates are in', `
    <div class="card" style="margin-top:24px;text-align:center;padding:26px 18px">
      <div style="font-size:34px">✓</div>
      <h2 style="margin:10px 0 6px;font-size:21px">No one beat your price.</h2>
      <p class="tiny muted">${held ? `Your ${M.fmt(pay(held))} with ${esc(req.held.partnerName)} is still ready. ` : ''}Nothing was charged.</p>
      ${held ? `<button class="btn btn--primary btn--lg btn--block" style="margin-top:18px"
        data-act="ask.held" data-id="${req.id}">Book ${M.fmt(pay(held))}</button>` : ''}
      <button class="btn btn--ghost btn--block" style="margin-top:8px"
        data-act="ask.cancel" data-id="${req.id}">Cancel</button>
    </div>`);
}

/* ── the receipt: the whole teaching path in three lines ───────
   Never a tour, never a modal explaining the mechanism. A customer who can
   describe how sealed bidding works is a customer we overspent on. The one
   number that drives repeat use is the rupees THEY saved on THEIR last job. */
export function showReceipt(req, paid, workerName) {
  const s = A.savings(req, paid);
  const zero = s.amount <= 0;
  sheet('', `<div style="text-align:center;padding:14px 4px 4px">
    <p class="tiny muted">You asked ${Math.max(1, s.replies)} ${Math.max(1, s.replies) === 1 ? 'worker' : 'workers'}.</p>
    <div style="margin:18px 0">
      <p class="tiny muted">You paid</p>
      <div class="num" style="font-size:36px;font-weight:800;line-height:1.1">${M.fmt(pay(paid))}</div>
    </div>
    ${zero
      // A zero shown AS zero kills the second use permanently. It is not a
      // loss — it is a confirmed good price, and it must read as one.
      ? `<p class="tiny" style="color:var(--ok);font-weight:700">Your held price was already the best rate.<br>Nothing lost.</p>`
      : `<div><p class="tiny muted">You saved</p>
         <div class="num" style="font-size:30px;font-weight:800;color:var(--ok);line-height:1.1">${M.fmt(payGap(s.amount))}</div></div>`}
    <p class="tiny muted" style="margin-top:16px">${esc(workerName)} is booked.</p>
    <button class="btn btn--primary btn--lg btn--block" style="margin-top:20px" data-act="sheet.close">Done</button>
  </div>`);
}

/* ── the worker's side ─────────────────────────────────────────
   The single most important element here is the LIVE chance meter dropping as
   he drags below the fair price. Workers do not read explanations of scoring
   functions; they drag a slider and watch a bar shrink, and that is the whole
   education, delivered before the mistake instead of after it. Pre-filling at
   the fair price with a one-tap send makes the LAZY action the CORRECT one,
   which is how a population actually moves.

   What is safe to show: the public band, the COUNT of workers asked, and his
   own standing. Never another worker's price, name, or whether anyone has
   replied at all — that is what "sealed" means. */
export function bidSheet(requestId, partner) {
  const req = A.requestById(requestId);
  if (!req) return;
  const cat = get('category', req.catId);
  const chips = budgetChips({ floor: req.floor, target: req.target, ceiling: req.ceiling });
  sheet(cat.name, `
    <p class="tiny muted">${esc(req.area)} · ${esc(req.sub || cat.name)} · asked ${Math.round((Date.now() - req.openedAt) / 60000)} min ago</p>

    <div class="card" style="margin-top:14px;padding:14px">
      <div class="between"><span class="tiny muted">Fair price for this job</span>
        <b class="num" style="font-size:22px">${M.fmt(req.target)}</b></div>
      <p class="micro muted" style="margin-top:6px">Most jobs here go ${M.fmt(req.floor)} – ${M.fmt(req.ceiling)}</p>
      <p class="micro muted" style="margin-top:4px">${req.bidCount} workers asked so far.</p>
    </div>

    <div class="card" style="margin-top:12px;padding:16px">
      <div class="between" style="margin-bottom:10px">
        <span class="tiny muted">Your rate</span>
        <b class="num" id="bidAmt" style="font-size:24px">${M.fmt(req.target)}</b>
      </div>
      <input type="range" id="bidRange" min="${req.floor / 100}" max="${req.ceiling / 100}"
             step="10" value="${req.target / 100}" style="width:100%"
             data-target="${req.target}" data-beff="${req.beff}">
      <div class="between"><span class="micro muted">${M.fmt(req.floor)}</span>
        <span class="micro" style="color:var(--ok);font-weight:700">▲ Best chance</span>
        <span class="micro muted">${M.fmt(req.ceiling)}</span></div>
      <div style="margin-top:14px">
        <div class="between"><span class="tiny muted">Your chance</span>
          <b class="tiny" id="chanceLbl">strong</b></div>
        <div style="height:9px;border-radius:99px;background:var(--surface-2);margin-top:5px;overflow:hidden">
          <i id="chanceBar" style="display:block;height:100%;width:100%;background:var(--ok);border-radius:99px;
             transition:width .18s ease,background .18s ease"></i></div>
      </div>
      <p class="micro muted" style="margin-top:10px">
        Sending less than ${M.fmt(req.target)} lowers your chance. It does not raise it.</p>
    </div>

    <button class="btn btn--primary btn--lg btn--block" style="margin-top:14px"
            id="sendBid" data-act="bid.send" data-id="${requestId}" data-pid="${partner.id}"
            data-amt="${req.target}">Send ${M.fmt(req.target)}</button>
    <button class="btn btn--ghost btn--block" style="margin-top:6px" data-act="sheet.close">Not interested</button>
  `);
  wireSlider(req);
}

function wireSlider(req) {
  const range = document.getElementById('bidRange');
  if (!range) return;
  const amtEl = document.getElementById('bidAmt');
  const bar = document.getElementById('chanceBar');
  const lbl = document.getElementById('chanceLbl');
  const btn = document.getElementById('sendBid');
  const band = { beff: req.beff, floor: req.floor, target: req.target, ceiling: req.ceiling, quoteOnly: false };
  /* The raw price score only spans 0.78–1.00 across this band, so dragging to
     the floor still read "strong" and the lesson never landed. Normalise it
     over the range actually reachable HERE: the meter then answers the real
     question — how does this rate compare with my best possible one — instead
     of quoting an absolute the worker cannot act on. */
  const worst = Math.min(priceScore(band.floor, band), priceScore(band.ceiling, band));
  const rel = a => (priceScore(a, band) - worst) / Math.max(1e-6, 1 - worst);
  const paint = () => {
    const paise = Math.round(Number(range.value) * 100);
    const pct = Math.round(rel(paise) * 100);
    amtEl.textContent = M.fmt(paise);
    bar.style.width = `${Math.max(6, pct)}%`;
    bar.style.background = pct > 75 ? 'var(--ok)' : pct > 45 ? 'var(--warn)' : 'var(--danger)';
    lbl.textContent = pct > 75 ? 'strong' : pct > 45 ? 'fair' : 'weak';
    btn.dataset.amt = String(paise);
    btn.textContent = `Send ${M.fmt(paise)}`;
  };
  range.addEventListener('input', paint);
  paint();
}

/** Post-job coaching, rendered honestly. "Your price was not the problem" is
    the line that stops undercutting — not a policy, not a warning, just his
    own numbers shown back to him. */
export function showLoserFeedback(fb) {
  if (!fb) return;
  sheet('This job went to someone else', `
    <p class="tiny muted">You sent ${M.fmt(fb.yourBid)}.</p>
    <p style="margin:8px 0"><b>The job went at ${M.fmt(fb.winningBid)}</b>
      ${fb.winningBid > fb.yourBid ? ` — ${M.fmt(fb.winningBid - fb.yourBid)} more than you.` : '.'}</p>
    <p class="tiny muted">He won on ${esc((fb.lostOn || []).join(' and ') || 'overall standing')}.</p>
    ${fb.winningBid > fb.yourBid
      ? `<p class="card" style="margin-top:14px;padding:12px;color:var(--ok);font-weight:700">
         Your price was not the problem.</p>` : ''}
    <button class="btn btn--primary btn--block" style="margin-top:16px" data-act="sheet.close">Got it</button>`);
}

export { beat };
