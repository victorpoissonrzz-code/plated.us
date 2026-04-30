// api/checkout.js
//
// Vercel serverless function that creates a Stripe Checkout Session
// and returns the hosted-checkout URL to the front-end.
//
// Required environment variables (set in Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY = sk_test_xxx  (or sk_live_xxx for production)
//
// Optional environment variables:
//   WEB3FORMS_KEY            = c764872c-...  (used to send order notification email to Victor)
//   ORDER_NOTIFICATION_EMAIL = victor@plated.us  (defaults to whatever is on the Web3Forms account)
//
// Front-end contract:
//   POST /api/checkout
//   Body: { lineItems, customerEmail, customerName, shippingAddress, delivery }
//   Returns: { url: 'https://checkout.stripe.com/...' }

const Stripe = require('stripe');

const SHIPPING_COUNTRIES = [
  'AC','AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CV','CW','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MK','ML','MM','MN','MO','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SZ',
  'TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','US','UY','UZ',
  'VA','VC','VE','VG','VN','VU',
  'WF','WS',
  'XK',
  'YE','YT',
  'ZA','ZM','ZW','ZZ'
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
}

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in Vercel environment variables');
    return res.status(500).json({ error: 'Payment service is not configured.' });
}

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const {
      lineItems = [],
      customerEmail = '',
      customerName = '',
      shippingAddress = {},
      delivery = {},
} = req.body || {};

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty.' });
}

    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ error: 'Valid customer email required.' });
}

    const stripeLineItems = lineItems.map(item => ({
      price_data: {
        currency: (item.currency || 'usd').toLowerCase(),
        product_data: {
          name: String(item.name || 'Item').slice(0, 250),
},
        unit_amount: Math.max(0, Math.round(Number(item.amount) || 0)),
},
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
}));

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: stripeLineItems,
      customer_email: customerEmail,
      shipping_address_collection: {
        allowed_countries: SHIPPING_COUNTRIES,
},
      locale: 'auto',
      success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment=cancelled`,
      metadata: {
        customer_name: String(customerName || '').slice(0, 500),
        delivery_label: String(delivery.label || '').slice(0, 100),
        delivery_cost_usd: String(delivery.cost || 0),
        cart_summary: lineItems
          .map(i => `${i.quantity}x ${i.name}`)
          .join(' | ')
          .slice(0, 500),
},
});

    if (process.env.WEB3FORMS_KEY) {
      sendOrderNotification({
        customerName, customerEmail, shippingAddress,
        lineItems, delivery,
        sessionId: session.id,
        sessionUrl: session.url,
}).catch(err => console.error('Notification email failed:', err.message));
}

    return res.status(200).json({ url: session.url });

} catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Payment processing failed.' });
}
};

async function sendOrderNotification({
  customerName, customerEmail, shippingAddress,
  lineItems, delivery, sessionId, sessionUrl,
}) {
  const total = lineItems.reduce((sum, i) => sum + (i.amount * i.quantity), 0) / 100;
  const itemsList = lineItems
    .map(i => `- ${i.quantity}x ${i.name} - $${(i.amount * i.quantity / 100).toFixed(2)}`)
    .join('\n');
  const addr = [
    shippingAddress.line1,
    shippingAddress.line2,
    `${shippingAddress.postal_code || ''} ${shippingAddress.city || ''}`.trim(),
    shippingAddress.country,
  ].filter(Boolean).join('\n');

  const payload = {
    access_key: process.env.WEB3FORMS_KEY,
    subject: `[Plated Order] New checkout: $${total.toFixed(2)} from ${customerName || customerEmail}`,
    from_name: 'Plated Orders',
    'Customer': `${customerName} <${customerEmail}>`,
    'Items': '\n' + itemsList,
    'Subtotal': `$${total.toFixed(2)}`,
    'Delivery': `${delivery.label || 'Standard'} ($${(delivery.cost || 0).toFixed(2)})`,
    'Shipping address': '\n' + addr,
    'Stripe Session ID': sessionId,
    'Stripe Checkout URL': sessionUrl,
    'Status': 'Checkout session created. Verify payment in Stripe Dashboard.',
    botcheck: '',
};

  await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
});
}
