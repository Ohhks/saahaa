/* SAAHAA · ui/checkout.js — how Razorpay Checkout is shown, and nothing else.

   core/gateway.js decides WHEN money is collected and posts the books; it
   never touches the DOM. This module is the opener it calls in 'razorpay'
   mode: load Razorpay's checkout script once (from checkout.razorpay.com —
   the CSP in index.html allows exactly that host), open the modal for the
   server-made order, and resolve with the payment id + signature the server
   will verify. A closed modal resolves {ok:false} — never a throw, never a
   silent success.

   In 'sim' mode this file is never called. */

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

export function ready() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Checkout did not load')));
    s.onerror = () => reject(new Error('Checkout script blocked or offline'));
    document.head.appendChild(s);
  });
  return loading;
}

/** The opener gateway.useOpener() receives. */
export async function open(order, cfg) {
  const Razorpay = await ready();
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const rz = new Razorpay({
      key: order.keyId, amount: order.amount, currency: 'INR', order_id: order.orderId,
      name: cfg.name || 'SAAHAA', description: order.purpose || 'SAAHAA payment',
      theme: { color: cfg.themeColor || '#7C3AED' },
      handler: r => finish({ ok: true, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => finish({ ok: false, reason: 'Payment window closed' }) },
    });
    rz.on('payment.failed', r => finish({ ok: false, reason: (r && r.error && r.error.description) || 'Payment failed' }));
    rz.open();
  });
}
