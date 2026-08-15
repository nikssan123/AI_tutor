# Stripe setup

Two environment variables, no product catalogue to build. Every checkout sends
its amounts inline from `src/lib/billing/prices.ts`, so there is nothing to
create in Stripe and nothing to keep in sync between test and live mode.

Do all of this in **test mode** first; [§5](#5-going-live) is the whole diff.

## 1. Account and key

Sign up at stripe.com. A new account lands in a **Sandbox** — that is test mode,
and it needs no business details, no bank account and no verification.

**Developers → API keys →** copy the **secret** key. The publishable key is
unused: this app never talks to Stripe from the browser.

```sh
STRIPE_SECRET_KEY=sk_test_xxxx
```

Leaving it unset is a supported state, not a broken one — `resolveStripe()`
falls back to an in-memory Stripe, so the app runs and nobody can be charged.
Setting it **without** `STRIPE_WEBHOOK_SECRET` (§3) is refused at startup,
because that combination takes payments and records none of them.

## 2. Turn on Stripe Tax

Checkout sends `automatic_tax[enabled]=true` on every session. With no origin
address on the account, Stripe rejects the session and checkout 500s.

**Tax → Settings:** origin address, and a **default tax code** — every line item
inherits it, since nothing sets a tax code per product. Then **Tax →
Registrations:** add at least your home country, or Stripe calculates 0
everywhere. Stripe computes and files nothing; the VAT return is still ours.

Prices carry their own `tax_behavior`, decided by currency in `prices.ts`: EUR
is `inclusive` (EU law — the displayed price is the paid price), USD is
`exclusive` (net, sales tax added on top). Nothing to configure, but it is the
thing to check first if a euro total ever looks 21% too large.

## 3. The webhook

Locally, the CLI is the endpoint — no tunnel, no dashboard entry:

```sh
stripe listen --forward-to localhost:3000/api/billing/webhook
```

It prints `whsec_…` once, on startup. That is `STRIPE_WEBHOOK_SECRET`, and it is
stable per machine, so paste it into `.env.local` and leave it.

For a deployed environment instead: **Developers → Webhooks → Add endpoint**,
`https://<host>/api/billing/webhook`, and select exactly these — everything else
is acknowledged and dropped, so subscribing to more only adds noise:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
charge.dispute.created
```

## 4. Run the flow

Save the customer portal settings once — **Settings → Billing → Customer portal
→ Save** — or `/billing_portal/sessions` errors and the "Manage billing" link on
`/account/billing` is dead. Test and live are configured separately.

Then `pnpm dev`, `stripe listen` in a second terminal, and walk `/pricing`.
Card `4242 4242 4242 4242`, any future expiry, any CVC; `4000 0000 0000 9995`
declines and `4000 0000 0000 3220` forces 3DS. Use a German billing address to
see the EUR/VAT path.

This is `PLAN-MONETIZATION` §15 steps 3–7, in the order they break:

1. **The €3 trial** — buy it. Confirm **€3 taken today** and a **€24.99 renewal
   scheduled 4 days out**. The fee is a one-off line item on a subscription
   session: Stripe puts one-time lines on the first invoice only, and a trial
   issues that invoice immediately. This is the one mechanic taken from
   documentation rather than measurement (§13 risk 8) — if the €3 does not land
   today, the fallback is a one-off Payment Intent plus a scheduled
   subscription.
2. **Lifecycle** — trial start → convert → payment failed → cancel → refund, all
   drivable from the dashboard. `user.plan` tracks every step, and replaying an
   event (`stripe events resend <evt_…>`) changes nothing the second time.
3. **A second checkout by the same account** — the path that reuses the Stripe
   customer. The tax should follow the address typed at checkout, not the one
   stored on the customer from last time.
4. **Both currencies** — the euro invoice total equals the price on the page;
   the dollar one is the page price plus any sales tax.
5. **Referral** — `/r/{code}` → sign up → pay → the referrer's 14 days exist.
   Refund, and both grants revoke.

## 5. Going live

Nothing in the code changes, and no prices need recreating:

1. **Activate the account** — business details, bank account, ID. This is the
   long pole; start it before you need it.
2. **Redo §2 and the portal in live mode.** Tax registrations and portal
   settings are mode-scoped; they do not carry over from the sandbox.
3. **Add the live webhook** (§3, dashboard form) at
   `https://meritkeep.xyz/api/billing/webhook`. New `whsec_…`.
4. **Put both live values** in `/srv/meritkeep/.env.prod` and redeploy
   (`gh workflow run deploy.yml -f ref=main`).
5. **Buy something with a real card**, then refund it.

A live key with a test webhook secret is the one dangerous mix: payments succeed
and nothing is ever recorded. Change the two together.

## What this costs

Stripe's Dashboard has no product catalogue for MeritKeep, because none is
created: each session generates an ad-hoc product and price. Revenue by plan
therefore comes from `metadata.planId` — on every session and every subscription
— rather than from Stripe's product reports, and the Products page will fill up
with one entry per purchase. That is the deliberate trade for having exactly one
place in the system where a price is written down.
