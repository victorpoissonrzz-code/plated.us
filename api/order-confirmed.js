// api/order-confirmed.js
//
// Vercel serverless function — Stripe Webhook handler
// Triggered by Stripe when a Checkout Session is completed (payment succeeded).
// Sends a confirmation email to the customer via Web3Forms.
//
// Required environment variables (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY        = sk_live_xxx
//   STRIPE_WEBHOOK_SECRET    = whsec_xxx  (from Stripe Dashboard → Webhooks → Signing secret)
//   WEB3FORMS_KEY            = c764872c-...
//
// Stripe webhook event: checkout.session.completed

const Stripe = require('stripe');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Verify the Stripe webhook signature to ensure the request is genuine
    let event;
    try {
          const rawBody = await getRawBody(req);
          const signature = req.headers['stripe-signature'];

      if (webhookSecret) {
              event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } else {
              // No secret configured — parse body directly (less secure, dev only)
            event = JSON.parse(rawBody.toString());
      }
    } catch (err) {
          console.error('Webhook signature verification failed:', err.message);
          return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    // Only handle checkout.session.completed
    if (event.type !== 'checkout.session.completed') {
          return res.status(200).json({ received: true });
    }

    const session = event.data.object;

    // Retrieve full session with line_items expanded
    let fullSession;
    try {
          fullSession = await stripe.checkout.sessions.retrieve(session.id, {
                  expand: ['line_items', 'line_items.data.price.product'],
          });
    } catch (err) {
          console.error('Failed to retrieve session:', err.message);
          return res.status(500).json({ error: 'Failed to retrieve session details' });
    }

    const customerEmail = fullSession.customer_details?.email || fullSession.customer_email || '';
    const customerName  = fullSession.customer_details?.name  || fullSession.metadata?.customer_name || '';
    const shipping      = fullSession.shipping_details?.address || {};
    const amountTotal   = (fullSession.amount_total || 0) / 100;
    const currency      = (fullSession.currency || 'usd').toUpperCase();
    const deliveryLabel = fullSession.metadata?.delivery_label || 'Standard delivery';
    const promoCode     = fullSession.metadata?.promo_code || '';
    const cartSummary   = fullSession.metadata?.cart_summary || '';

    // Build items list from line_items
    const itemsList = (fullSession.line_items?.data || [])
      .map(li => `- ${li.quantity}x ${li.description || li.price?.product?.name || 'Item'} — ${currency} ${(li.amount_total / 100).toFixed(2)}`)
      .join('\n');

    const shippingAddr = [
          shipping.line1,
          shipping.line2,
          `${shipping.postal_code || ''} ${shipping.city || ''}`.trim(),
          shipping.state,
          shipping.country,
        ].filter(Boolean).join(', ');

    // Send confirmation email to the customer
    if (process.env.WEB3FORMS_KEY && customerEmail) {
          try {
                  await sendConfirmationEmail({
                            customerEmail,
                            customerName,
                            itemsList,
                            amountTotal,
                            currency,
                            deliveryLabel,
                            promoCode,
                            shippingAddr,
                            sessionId: session.id,
                  });
          } catch (err) {
                  console.error('Confirmation email failed:', err.message);
          }
    }

    return res.status(200).json({ received: true });
};

// ─── Read raw request body (needed for Stripe signature verification) ─────────
function getRawBody(req) {
    return new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', chunk => chunks.push(chunk));
          req.on('end',  () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
    });
}

// ─── Send order confirmation email to the customer ───────────────────────────
async function sendConfirmationEmail({
    customerEmail,
    customerName,
    itemsList,
    amountTotal,
    currency,
    deliveryLabel,
    promoCode,
    shippingAddr,
    sessionId,
}) {
    const firstName = customerName ? customerName.split(' ')[0] : 'there';

  const payload = {
        access_key: process.env.WEB3FORMS_KEY,
        // Send TO the customer
        to: customerEmail,
        subject: `Your Table00 order is confirmed!`,
        from_name: 'Table00',
        // Plain-text body
        message: `Hi ${firstName},

        Thank you for your order! We are preparing it with care.

        ─────────────────────────────
        ORDER SUMMARY
        ─────────────────────────────
        ${itemsList || cartSummary || '(see Stripe receipt for details)'}

        Delivery: ${deliveryLabel}
        ${promoCode && promoCode !== 'none' ? `Promo code: ${promoCode}\n` : ''}Total paid: ${currency} ${amountTotal.toFixed(2)}

        Shipping to: ${shippingAddr || 'address provided at checkout'}
        ─────────────────────────────

        You will receive a separate receipt from Stripe.
        If you have any questions, reply to this email or contact us at orders@table00.com.

        With care,
        The Table00 Team
        www.table00.com`,
        botcheck: '',
  };

  const response = await fetch('https://api.web3forms.com/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(payload),
  });

  if (!response.ok) {
        const text = await response.text();
        throw new Error(`Web3Forms error: ${text}`);
  }
}
