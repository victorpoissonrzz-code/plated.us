# Plated — Deployment Guide

## What's in this folder

```
plated-v66/
├── index.html              The site (single page app)
├── images/                 14 product/visual images
├── favicon.png             Browser tab icon (P, gold on black)
├── favicon.ico             Legacy favicon
├── apple-touch-icon.png    iOS home screen icon
├── og-image.jpg            Social share preview (LinkedIn, iMessage, etc.)
├── site.webmanifest        PWA install config
├── vercel.json             Cache + security headers
├── package.json            Declares the Stripe npm dependency
└── api/
    └── checkout.js         Serverless function: creates Stripe Checkout sessions
```

## Deploy to Vercel

1. Go to https://vercel.com and sign in
2. New Project → drag-and-drop this entire folder
3. Vercel detects it's a static site with serverless functions and deploys
4. **Before testing checkout**, set environment variables (next section)

## Environment variables (Vercel → Project → Settings → Environment Variables)

Required:

| Name | Value | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (or `sk_live_...`) | Get from https://dashboard.stripe.com/apikeys. Start with TEST mode. |

Optional (recommended):

| Name | Value | Notes |
|---|---|---|
| `WEB3FORMS_KEY` | `c764872c-86d7-4618-bfb8-1c846bdc6311` | Same key as the contact/join forms. Sends an internal email to Victor whenever a new checkout starts. |

After adding/changing variables, **redeploy** the project (Deployments → ⋯ → Redeploy) for the changes to take effect.

## Test the checkout end-to-end

1. With `STRIPE_SECRET_KEY` set to a `sk_test_...` key, go to your live site
2. Add a product → cart → checkout
3. Fill the form (any email, address)
4. Click Pay → you'll be redirected to a Stripe-hosted checkout page
5. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any ZIP
6. After payment, you'll be redirected back to `/?payment=success&session_id=...`
7. Verify the order appears in https://dashboard.stripe.com/test/payments
8. If `WEB3FORMS_KEY` is set, you'll also receive an email at the address linked to that Web3Forms key

## Going live

When ready for real payments:

1. In Stripe Dashboard, complete account activation (business info, bank account)
2. Replace `STRIPE_SECRET_KEY` env var with your `sk_live_...` key
3. Redeploy
4. Test once with a real card (you can refund yourself after)

## Forms (already wired)

Both the **Contact** form and the **Join Plated** form submit directly to Web3Forms using the key embedded in `index.html`. Submissions arrive at the email address registered with Web3Forms. No env variable needed for those (the key is public-by-design for client-side form services).

## Troubleshooting

**Checkout button shows "Sorry, we could not start your payment"**
- Check Vercel → Functions → `/api/checkout` logs for the actual error
- Most common cause: `STRIPE_SECRET_KEY` not set or invalid. Verify in Vercel Settings → Environment Variables.
- After setting/changing the variable, you must redeploy.

**Stripe Checkout opens but payment fails immediately**
- You may be using a `sk_live_...` key with a test card, or a `sk_test_...` key with a real card. Match them.

**Forms (Contact / Join) don't send**
- Check browser console for the API response from web3forms.com
- The first time, Web3Forms sends a verification link to the destination email — you must click it to activate submissions.
