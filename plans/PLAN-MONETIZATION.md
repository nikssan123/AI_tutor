# Monetization Plan — four tiers · a €3 paid trial · Stripe in two currencies · referral

Companion to `PLAN.md`. Nothing here is appended to that document; where the two disagree, this one wins **for pricing, billing and referral concerns only**. It closes **E13** and adds **E14**.

## 0. What this replaces, and the honest framing

`PLAN.md` §0 says it plainly: *"from here the remaining work is acquisition and money rather than product."* E1–E10 are done, E11 and E12 are partial, and E13 is the last epic with **nothing built** — §24's status table reads "emails ship; billing does not."

A learner can today state a goal, sit an adaptive diagnostic, receive a validated curriculum, run sessions with a tutor, submit real work, have it graded against a public rubric with evidence quotes, and watch a mastery ledger accumulate. **Nobody can pay for any of it.**

This plan is a deliberate departure from §20.1 in five places. The founder was shown each conflict and chose against the plan document in every one. That is recorded in §1 and is not re-litigated here.

| Layer | Cost | Compounding risk | Verdict |
|---|---|---|---|
| **Plan catalog + entitlements + quota** | ~2 days, pure functions | None — it is arithmetic over rows | **Build first.** Everything else depends on it, and it is the part §14.9.7 already specified and never wired |
| **Stripe subscription + webhook** | ~3 days | Low, but it is the one component that can charge the wrong amount | **Build second**, behind the price assertion in §3 |
| **Surfaces (`/pricing`, billing, cancellation)** | ~2 days | Low | **Build third** |
| **Referral (E14)** | ~2 days | **Medium — this is the one that can be farmed** | **Build last**, with §9.3's rules from the first commit rather than after the first abuse |

**The one-sentence rule for the whole document:** *the price shown is the price charged, the meter is the evaluation, and a grant is never a payment.*

---

## 1. Decisions

Taken 2026-08-15. The first six override `PLAN.md` or `PLAN-LOCALIZATION.md` explicitly.

| # | Decision | Call | What it overrides |
|---|---|---|---|
| 1 | Processor | **Stripe**, with Stripe Tax for calculation | §18.1 *"Do not hand-roll VAT with raw Stripe"* · §26 risk 13 · §24 E13 "Polar/Paddle" |
| 2 | Currencies | **USD and EUR**, both live from day one | — (matches `PLAN-LOCALIZATION` §6.5) |
| 3 | Trial | **€3/$3 for 4 days**, auto-renewing to Pro | No trial exists anywhere in any document |
| 4 | Tiers listed | **Free · Trial · Learner · Pro**, all four on `/pricing` | §20.1 *"Launch with one paid tier. Two tiers doubles the decision friction"* |
| 5 | Prices | **$24.99/€24.99 monthly · $199/€199 annual · $12.99/€12.99 Learner** | §20.1 ($25/$190) · `PLAN-LOCALIZATION` §6.1 (€25/€190) · §20.1's *"under $15"* rejection |
| 6 | Referral reward | **14 days of Pro to each side** | No referral program exists anywhere in any document |
| 7 | Free tier | **1 evaluation · 2 sessions · 15 tutor questions · canonical curriculum · no new subjects · 120¢.** Derived from a budget rather than asserted — §20.1's version was never affordable at its own cap (§2) | §20.1's "3 sessions/week" and its 100¢ ceiling |
| 8 | The meter | **The evaluation**, as §20.1 already says. Never tokens, never messages | — |
| 9 | Source of truth | The `subscription` row. `user.plan` is a derived fast path, reconciled in one place | — |
| 10 | Grants | A referral or comp resolves to Pro **entitlements** at the **trial spend cap** | — |
| 11 | Referral tiers (3/5/10) | **Not built.** The brief itself says start with the simplest mechanic | Brief §13 |
| 12 | Shareable learning paths | **Not built in this pass** — §22.2's gate cannot be cleared yet (§9.5) | Brief §14 |

### Two consequences to engineer around rather than argue with

1. **The trial is a loss leader.** €3 gross is ≈€2.40 net of VAT and Stripe fees, against as much as $5 of AI in four days of Pro capability. Bounded by giving the trial **its own spend cap** rather than Pro's (§2). Breakeven is roughly **11% trial→paid** against Pro's first month.
2. **A 14-day Pro grant is not a payment.** A referral reward that carried Pro's $15 monthly cap would let two colluding accounts draw $30/month of inference for nothing. Grants resolve at the trial cap, which is the whole cost defence.

### Rejected

- **A quota-metered trial** (*"€3 for three graded projects"*) — margin-neutral at ~$1.35 of AI, no clock to lose to, and it sells the differentiator rather than the commoditized layer. Rejected in favour of the time-boxed trial, which is more familiar and carries real urgency.
- **Learner as a cancellation-only save offer** — would have kept §20.1's "one decision" property while still rescuing price-sensitive churn. Rejected in favour of listing all four tiers.
- **Merchant of Record (Polar/Paddle)** — ~4% of gross but owns VAT registration, OSS filing and invoicing. Rejected in favour of Stripe's ~1.5% + €0.25 on EEA cards; see §13 risk 1 for what that buys and what it costs.
- **Round prices ($25/€25, $190/€190)** — `PLAN-LOCALIZATION` §6.2's position, that a price is a positioning signal and round local numbers beat FX-derived ones. Rejected in favour of charm pricing.

---

## 2. The plan catalog

`src/lib/billing/catalog.ts`. A plain module — **not** `"use server"`; `pnpm actions:audit` fails the build on a non-async export from an action module, and this file is nothing but constants and pure functions.

```ts
export type PlanId = "free" | "trial" | "learner" | "pro";
export type Interval = "month" | "year";
export type Currency = "usd" | "eur";
```

**An entitlement is a thing the system refuses to do, not a thing a marketing table claims.** Every column below is checked in code before the spend it governs happens:

| Plan | Listed | **Evaluations/mo** | **Sessions/mo** | **Tutor Qs/session** | Curriculum | New subjects | Models | **Spend cap** |
|---|---|---|---|---|---|---|---|---|
| `free` | ✅ | **1** | **2** | **15** | canonical | ✗ | standard | **120¢** |
| `trial` | ✅ | **5** | ∞ | 30 | generated | ✓ | premium | **450¢** |
| `learner` | ✅ | **3** | ∞ | 30 | generated | ✓ | standard | **600¢** |
| `pro` | ✅ | **10** | ∞ | 30 | generated | ✓ | premium | **1500¢** |

`free` and `pro` are §20.1 and §14.9.7 limits 1 and 2 **unchanged**. `trial` and `learner` are new, and every number is derived rather than guessed:

- **Trial — 5 evaluations, 450¢.** Four days of Pro capability against €3 (≈$2.60 net of VAT and fees). Five graded projects is more than any human does in four days, so it is "full Pro" in practice while costing $2.25 at §20.2's measured $0.45; with a curriculum, a diagnostic and a few sessions the expected case is ~$2.70 and the capped worst case is $4.50. **Pro's ten-a-month is deliberately not what a four-day window carries** — it would let the trial cost more than the first paid month it exists to sell. It degrades Opus→Sonnet at the ceiling, exactly as §14.9.7 limit 1 already does: service continues, it does not stop.
- **Learner — 3 evaluations, 600¢.** ~$1.35 of marking against €12.99 gross ≈ €10 net. ~88% gross margin, which is what dissolves §20.1's *"under $15 … can't cover heavy users"* objection: **the quota covers heavy users, not the price floor.** That objection was correct about the risk and wrong about the instrument.

### The invariant that keeps a quota honest

**A plan's spend cap must be able to pay for everything the plan advertises**, or the learner reaches the cap first and the numbers on the pricing page are ones they can never reach. Three measured constants live in the catalog for exactly this — `EVALUATION_COST_CENTS = 45`, `SESSION_COST_CENTS = 17`, `ONBOARDING_COST_CENTS = 16`, all from §20.2 — and `promisedCostCents()` adds them up. A test asserts `spendCapCents ≥ promisedCostCents(plan)` for every plan with a finite session allowance.

It has caught two things already, both by failing rather than by review:

- **The trial** was first written with Pro's ten evaluations behind a 500¢ cap, which advertises ten and pays for eleven.
- **§20.1's free tier**, which had never been checked against §14.9.7's free ceiling at all. 71¢ of onboarding plus 221¢ of sessions plus a 45¢ evaluation, against 100¢. The narrower version of this invariant (evaluations only) passed it; the wider one does not, which is why the wider one exists.

### What "standard models" may and may not degrade

The brief sells *standard models* on Learner and *premium models* on Pro. Applied bluntly that puts a Learner's **rubric grading** on Sonnet instead of Opus — which sells a **worse verdict to a cheaper customer**. Three reasons that is the wrong reading, and the code follows the other one:

- §14.5 calls the Evaluation Agent the most important component in the system and §4.2 law 1 makes the graded verdict the product's whole claim. A claim that varies by price is not a claim.
- §21 identifies the calibration corpus as the only real moat. Grading half the submissions on a different model forks that corpus by plan and makes the κ measurement meaningless.
- §7.2's evaluation tiers already describe what evidence we can honestly produce. Money is not one of the inputs.

So `degradesGeneration(planId)` gates **curriculum validation and pack authoring** — outputs a learner can see, reject and regenerate — and never marking. `src/lib/evaluation/index.ts` consults the month's spend ceiling only, with the reason written at the call site.

**A cheaper plan buys fewer evaluations, never worse ones.**

### Two limits §20.1 lists that are deliberately **not** enforced

- **Sessions per week** ("3/week" on free). The spend cap already binds tighter than the counter would: at §20.2's measured $0.17 a session, free's 100¢ ceiling is about five sessions a month against the counter's thirteen. A second, weaker limiter would be dead code that reads like a guarantee.
- **Active goals** — "1 goal" on free in §20.1, and the brief wants 3 on Learner and unlimited on Pro. **The engine is single-goal by construction.** `pauseOthers` (`src/lib/goals/store.ts:116`) pauses every other course whenever one becomes active, with a docblock explaining that the alternative is *"a plan quietly swapping under a learner who was never told they had two"*; `activeGoal()` returns one row to fifteen call sites including `/today`, `/calendar`, `/progress` and the planner.

  Selling "3 goals" or "unlimited goals" would be selling an engine capability that does not exist and that the engine actively prevents. **Multi-goal is its own epic** — it touches the planner and every product screen — and it is not a billing flag. Until it lands no plan may claim it, and `/pricing` differentiates on evaluations, models and depth instead. §4.2 law 3, turned on our own price list.

---

## 3. Prices and currency

`src/lib/billing/prices.ts` — a frozen table keyed `(planId, interval, currency)` carrying `{ amountCents, currency, stripePriceId }`. Price IDs are read from env; amounts are never hardcoded in two places.

| | USD | EUR |
|---|---|---|
| Trial fee (one-off, then Pro monthly in 4 days) | **$3.00** | **€3.00** |
| Learner monthly | **$12.99** | **€12.99** |
| Pro monthly | **$24.99** | **€24.99** |
| Pro annual | **$199.00** | **€199.00** |

Annual is **33% off** monthly (`24.99 × 12 = 299.88` → `199`). §20.1's framing said 37%; the copy must say 33% or say nothing, because a wrong discount claim on a pricing page is the kind of error that is quoted back at you.

EUR prices display **VAT-inclusive**, as EU consumer law requires and `PLAN-LOCALIZATION` §6.2 already established. Stripe Tax adds US sales tax on top where nexus exists.

### The rule that prevents the P0

`PLAN-LOCALIZATION` §6.3 rule 1: *"The displayed price must equal the charged price. If the pricing page shows €25 and checkout charges $25, that is a P0 bug, not a rounding difference."*

**Enforced in code, not by hope.** `createCheckoutSession()` reads the Stripe Price back and refuses to create the session when `unit_amount` or `currency` disagrees with the table the page rendered from. A mismatch throws and emits an analytics event; it never silently charges.

### Currency resolution

`PLAN-LOCALIZATION` §6.5, already specified, unchanged here: the static HTML carries the **locale-implied** currency (`en`→USD, `de`/`es`/`bg`→EUR); a small client island swaps only on genuine mismatch, reading and writing `mk_currency`; **the price slot reserves a fixed width** so §13.3's CLS <0.05 budget survives the swap. Checkout reads the same cookie. One source, two readers, no divergence.

**Currency is locked at first subscription** and never changes for that subscription (§6.3 rule 2). One line in the pricing FAQ, rather than something support discovers.

---

## 4. Data model

New file `src/db/schema/billing.ts`, exported from `src/db/schema/index.ts`. `user.id` is `text`, so every foreign key is `text("user_id")` with `onDelete: "cascade"`.

| Table | Purpose | The constraint that matters |
|---|---|---|
| `subscription` | **Source of truth.** `planId`, `interval`, `currency`, `amountCents`, `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEndsAt`, `endedAt` | `uniqueIndex(stripeSubscriptionId)` |
| `billing_event` | Webhook idempotency and audit. Raw `payload` kept as jsonb | `uniqueIndex(stripeEventId)` — the `mailMessage.providerId` precedent, and the reason a replayed webhook changes nothing |
| `plan_grant` | Entitlement not bought with money. `source` ∈ `referral` \| `comp`, `startsAt`, `endsAt`, `revokedAt` | — |
| `referral_code` | One shareable code per user | `uniqueIndex(code)`, `uniqueIndex(userId)` |
| `referral` | One row per referred person. `status`, `signupAt`, `firstPaymentAt`, `rewardedAt`, `rejectedReason`, `signupIpHash`, `signupUaHash` | **`uniqueIndex(refereeId)`** — "one referral per person" is a database constraint, not a check that can be raced |
| `cancellation_survey` | §25.1's mandatory exit reason | — |

**`user.plan` stays**, as the denormalized fast path. It is on the session DTO (`src/lib/account/session.ts` `AccountUser`) and read on nearly every request; a join per request to answer "what plan is this" would be a real cost. The webhook reconciles it from `subscription`. Two places holding one fact is tolerable **only** because one is derived and the derivation lives in exactly one function.

`user.stripeCustomerId` already exists (`src/db/schema/auth.ts:30`) and has never been read or written by anything. Choosing Stripe makes it real; no rename.

`spend_ledger.evaluations_used` also already exists (`src/db/schema/ops.ts`) and has never been written. It is the meter §20.1 has been describing since it was written. **No new table is needed for the quota** — it has had a home all along.

**After the migration:** re-run `pnpm console:role` (`.env.example` says so — `src/lib/admin/grants.ts` generates column-level GRANTs for the read-only SQL console from the Drizzle schema), and add `subscription.status` and `user.plan` to `PROTECTED_UPDATE_COLUMNS` so the console cannot hand out a paid plan.

---

## 5. Entitlements and the quota

### The resolver — a pure function

`src/lib/billing/entitlements.ts`:

```ts
entitlementsFor(
  { plan, subscription, grants }: EntitlementInput,
  now: Date,
): {
  planId: PlanId;
  entitlements: Entitlements;
  spendCapCents: number;
  source: "plan" | "grant" | "subscription";
}
```

Resolution order, highest wins:

1. **An active `plan_grant`** — Pro entitlements at the **trial** spend cap (§1 decision 10).
2. **An active `subscription`**, including one with `cancelAtPeriodEnd` set, right up to `currentPeriodEnd`. Somebody who has cancelled has paid for the rest of the month and keeps it.
3. **`past_due`** keeps entitlements through one dunning cycle, then drops to `free`. Cutting a paying customer off over a card that expired is how you lose one who wanted to stay.
4. **`free`.**

Pure over rows, so every branch is reachable in a unit test — which the 100% branch threshold requires and which a resolver reading the database directly would not be.

### The meter

`src/lib/billing/quota.ts` — `consumeEvaluation(db, userId, limit, now)`, a **conditional atomic upsert**:

```sql
insert into spend_ledger (user_id, period, evaluations_used) values (…, 1)
on conflict (user_id, period) do update
  set evaluations_used = spend_ledger.evaluations_used + 1
  where spend_ledger.evaluations_used < $limit
returning evaluations_used
```

No row returned means the quota is spent. Read-modify-write would let two concurrent submissions both pass — precisely the failure the `spend_ledger` unique index docblock already warns about for cost, in the one direction §14.9.7 cannot tolerate being wrong in.

**Consumed at submission creation** (`src/lib/submissions/project.ts`), *before* the Inngest job is enqueued. A learner must be told at the point of action, not after a 45-second wait for a grade that was never going to arrive. On refusal: `capture("quota_reached", …)` and the upgrade prompt §14.9.7 limit 2 has always specified.

### Two holes this closes on the way past

- **`src/lib/inngest/functions.ts`** calls `evaluateSubmission({ client, db, userId })` with **no `plan`**, so `shouldDegrade` has never run on marking — the single most expensive operation in the product, and until now the only AI call site outside the cap.
- **`src/app/(app)/goals/[id]/path/actions.ts:83`** hardcodes `plan: "free"` under the comment *"Everyone is on the free cap until E13 brings billing."* This is E13.

Also: `SPEND_CAP_CENTS` moves from `src/lib/ai/runlog.ts` into the catalog, `shouldDegrade` takes a `PlanId`, and `src/lib/admin/console.ts:71`'s `case ${user.plan} when 'pro' … else …` must learn the two new plans or the console reports the wrong cap for half the user base.

---

## 6. Stripe

`src/lib/billing/stripe/` — plain `fetch`, form-encoded bodies, **no `stripe` package**. This mirrors `ResendTransport`, which talks to Resend over `fetch` for the same reason: one less dependency to audit, and nothing in the SDK we need.

| File | Exports |
|---|---|
| `client.ts` | `stripeFetch(path, init)` — bearer `STRIPE_SECRET_KEY`, `Idempotency-Key` on every write |
| `checkout.ts` | `createCheckoutSession({ userId, planId, interval, currency })` + the §3 price assertion |
| `webhook.ts` | `verifySignature(rawBody, header, secret, now)` · `handleEvent(db, event)` |
| `portal.ts` | `createPortalSession(customerId, returnUrl)` — Stripe hosts card updates and invoice history, so we do not build them |
| `../memory.ts` | `MemoryBilling` — an in-process fake for tests and for local development with no keys |

`resolveBilling()` mirrors `resolveTransport()` exactly: no `STRIPE_SECRET_KEY` → `MemoryBilling`; a key but no `STRIPE_WEBHOOK_SECRET` → **throw a loud, actionable error** rather than accept unverified webhooks. That fallback is what keeps coverage at 100% without a network call in CI.

### The webhook

`src/app/api/billing/webhook/route.ts` — `POST`, `await request.text()`, because **the signature is over raw bytes** and any parse-then-reserialize invalidates it. `src/app/api/email/inbound/route.ts` already carries this note; Stripe's `t=`/`v1=` HMAC is the same shape as the svix signature `src/lib/mail/inbound.ts` verifies.

Order of operations: verify → insert `billing_event` → **let the unique index reject the replay** → handle. Idempotency is a constraint, not a lookup.

Events handled: `checkout.session.completed` · `customer.subscription.created` / `.updated` / `.deleted` · `invoice.paid` · `invoice.payment_failed` · `charge.refunded` · `charge.dispute.created`.

Each writes `subscription`, reconciles `user.plan`, and emits its §25.1 event. `invoice.paid` is also the referral qualification trigger (§9).

### Env

A Billing block in `.env.example`: `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `STRIPE_PRICE_PRO_MONTH_USD`/`_EUR` · `STRIPE_PRICE_PRO_YEAR_USD`/`_EUR` · `STRIPE_PRICE_LEARNER_MONTH_USD`/`_EUR` · `STRIPE_PRICE_TRIAL_FEE_USD`/`_EUR`.

---

## 7. The trial

One Checkout Session in `subscription` mode:

- line item: the **Pro monthly** price, in the resolved currency;
- `subscription_data.trial_period_days: 4`;
- `subscription_data.add_invoice_items: [{ price: TRIAL_FEE_PRICE }]` — the €3/$3 one-off, which lands on the **first** invoice. During a trial that invoice is issued immediately at €0, so €3 is charged now and €24.99 renews on day 4.

**This is the one mechanic in this plan asserted from documentation rather than measurement.** Verify it in Stripe test mode before building on it (§15 step 3). The house rule is "measured rather than estimated", and invoice timing is exactly the kind of behaviour that is 95% as documented and 5% surprising.

Checkout copy is fixed by the brief and must not be softened:

> **€3 today.** Full Pro access for 4 days. After 4 days your subscription renews automatically at **€24.99/month** until cancelled. Cancel anytime from your account.

Day 3 sends `trialEndingTomorrow`. That email is the conversion moment and it must state the renewal date and amount plainly; a trial that renews on someone who forgot is a chargeback and a refund, not revenue.

---

## 8. Surfaces

| Route | Group | Indexable | What |
|---|---|---|---|
| `/pricing` | `(marketing)` | ✅ | Four plans, locale-implied currency, **one filled button** (the €3 trial). `AggregateOffer` JSON-LD. Added to `sitemap.ts`'s `hubs` |
| `/r/[code]` | `(marketing)` | ❌ | Sets `mk_ref` (90d, `httpOnly`, `sameSite: lax`), redirects to `/` with the referrer's display name. `/r/` added to `robots.ts` |
| `/account/billing` | `(app)` | ❌ (layout) | Plan, renewal date, change plan, Stripe portal link, cancel |
| `/account/referrals` | `(app)` | ❌ | Code, copy link, share targets, referral status |
| `/api/billing/webhook` | — | — | Stripe |

`/pricing` composes the existing vocabulary — `PageFrame`, `PageIntro`, `SectionHead` from `src/components/marketing.tsx`; `Card`, `ButtonLink`, `Figure`, `Meta` from `src/components/ui/index.tsx`. §8.5.5's **one filled button per screen** rule decides the primary CTA for us: the €3 trial is filled, everything else is a text button.

Checkout starts from a **server action** (`startCheckoutAction`) that redirects to the Stripe-hosted URL. That is the house pattern, it works with JS off, and the action re-guards with `requireUser()` because — as `src/app/admin/data/actions.ts` puts it — *"a Server Action is a public POST endpoint regardless of what the page that rendered the button looked like."*

### Cancellation

`/account/billing` → cancel shows **"You still have Pro until 20 August"**, then offers *continue* / *switch to Learner* / *cancel*.

The exit-survey reason is **required** — §25.1 marks it mandatory, in bold, and it is the only structured signal this product will get about why people leave. Six options from the brief (too expensive · not enough time · didn't find what I wanted · AI quality · learning experience · other) plus a free-text comment. Writes `cancellation_survey`, then sets `cancel_at_period_end` on Stripe.

Copy says *"You still have Pro until 20 August"*, never *"your subscription has `cancel_at_period_end` set"*. State the consequence, not the mechanism.

---

## 8.5 Asking somebody to pay

Free is a real plan and stays one. What makes it convert is not scarcity but
**placement**: a learner meets a wall at a moment when the thing on the other
side of it is obvious, and is told what a paid plan would have done instead.

`src/lib/billing/nudge.ts` is the whole list, in one pure function, so the tone
can be read at once and the total frequency is something somebody chose rather
than something that accumulated. `src/components/upgrade-nudge.tsx` renders it
and is the only place §25.1's `paywall_viewed` is emitted.

**Four moments, ranked by how well they convert:**

| Moment | Where | Why it is the right time |
|---|---|---|
| **A graded verdict has just landed** | `/submission/{id}` | §19.3's activation event. The only screen where the ask is "more of what you just had" rather than "trust us". Shown *below* the verdict — somebody reading their own marked work should finish reading it |
| The month's marking is spent | `/session/{id}?error=quota` | The box below it will not do anything, and unlike an empty hand-in there is nothing to correct |
| The month's sessions are spent | `/today?error=sessions` | The one wall on that screen |
| The session's questions are spent | tutor `409` | Quotes the plan's own number |

**Three rules, and the third is the one worth keeping:**

1. **Only at a wall** — never on a timer, never on a page merely visited.
2. **Only to somebody who could act on it** — every branch checks the
   entitlement rather than the plan name, so a Learner who has spent three
   evaluations is treated like a free learner who has spent one, and nobody is
   sold a sidegrade.
3. **Never on our own failure.** No nudge for a model that refused, a
   generation that failed, or a webhook that did not arrive. This is why
   `lessonForBlock` distinguishes `capped` from a plain absent lesson: one is a
   limit the learner can act on, the other is ours to apologise for, and
   selling on the back of a fault is the fastest way to make the paywall feel
   like the point of the product.

---

## 9. Referral — E14

**The mechanic:** the referee gets **14 days of Pro** at signup, no card. The referrer gets **14 days of Pro** when the referee's **first payment succeeds**.

### 9.1 Attribution

`/r/{code}` sets the cookie. The `referral` row is written in a **`databaseHooks.user.create.after` hook in `src/lib/auth.ts`** — not in the sign-up action.

This is the load-bearing detail. `src/app/(app)/sign-up/actions.ts` handles email signup only; **Google OAuth never passes through it**, and Better Auth has no `databaseHooks` configured today. Attribution in the action would silently lose every social signup, and it would look like it worked.

### 9.2 Reward

`invoice.paid` where the payer has a `pending` referral → `qualified` → `rewardReferral()` writes a 14-day `plan_grant` for the referrer and converts the referee's if it is still running. Entitlements resolve grants at the **trial** spend cap (§5), which is the cost bound.

### 9.3 Abuse rules

`src/lib/referral/abuse.ts` — pure, exhaustively tested, and written in the first commit rather than after the first abuse. Refuse with a recorded `rejectedReason`:

| Rule | Mechanism |
|---|---|
| **Self-referral** | Referee is the referrer, or shares their address after normalisation — lowercase, strip `+tag`, strip dots on Gmail-shaped addresses |
| **Already referred** | `uniqueIndex(refereeId)`. A constraint, not a check |
| **Signal collision** | Same `signupIpHash` **and** `signupUaHash` as the referrer within 24h. Hashed with a server-side pepper; raw IPs are never stored, per `PLAN-LOCALIZATION` §5.2 |
| **Reward before payment** | Never grant on signup alone. `firstPaymentAt` is the trigger |
| **Refund or chargeback** | `charge.refunded` / `charge.dispute.created` on a qualifying invoice → `rejected`, `revokedAt` on both grants |

Grant on first successful payment and **revoke on refund**, rather than holding a reward back through a refund window. Revocation costs nothing here because the reward is a date, not money — and a referrer who waits a week for a reward that was promised on payment stops referring.

### 9.4 Not built: referral tiers

The brief's §13 milestones (3 → 1 month, 5 → 2 months, 10 → 6 months) are deliberately out. The brief itself says *"Don't launch all of these immediately. Start with the simplest mechanic."* Adding them later is a table and a resolver; adding them now is four more reward paths to test before a single referral has happened.

### 9.5 Not built: shareable learning paths

The brief's §14 wants a shareable curriculum page. `public_learning_path` already exists in `src/db/schema/seo.ts`, and **§22.2 already decided the hard part**: a public path is gated on **≥3 evaluated artefacts + ≥1 completed project + a non-trivial written reflection**, because ungated auto-published per-user pages are *"precisely the scaled-content-abuse pattern that lost sites 60–90% of traffic."*

No learner can clear that bar until people have been paying for weeks. Building the page now would mean either shipping it empty or shipping it ungated, and the second one is the mistake §22.2 exists to prevent. It belongs in a third pass.

---

## 10. Emails, analytics, admin

**Emails** — new entries in `src/lib/email/catalog.ts`, with copy in **all four locales**. `EmailStrings = typeof en`, so an `en` key without a `de`/`bg`/`es` counterpart fails `pnpm typecheck`; the translation is not optional and cannot be deferred to a follow-up.

`trialStarted` · `trialEndingTomorrow` · `trialConverted` · `paymentFailed` · `subscriptionCancelled` · `referralRewarded`.

> **This grows `HUMAN-REVIEW.md` part D.** That item is currently nine strings per language, twenty minutes, and explicitly *"not urgent"*. Six billing emails roughly double it — and unlike part D today, **this copy gates revenue in German, Spanish and Bulgarian.** It moves from "nice to have" to "blocks launch in three of four locales", and part D should be amended to say so.

**Analytics** — add to the `AnalyticsEvent` union in `src/lib/observability/index.ts`. §25.1 already names the first six and the union simply never grew them:

`paywall_viewed` · `checkout_started` · `subscription_created` · `quota_reached` · `subscription_cancelled` · `subscription_reactivated` · `share_clicked` · `referral_visit` · `referral_signup` · `referral_qualified` · `referral_rewarded`.

**Admin** — `PLANS` in `src/lib/admin/users.ts` grows from two to four. The plan-flip UI in `src/app/admin/data/[table]/page.tsx` picks "the other one" with `PLANS.find((c) => c !== plan)!` and **is wrong the moment there are more than two**; it needs a select.

`setUserPlan`'s message ends *"Stripe is unchanged."* — which stays true and stays correct. An operator granting a plan is issuing a comp, not recording a payment, so route it through `plan_grant` with `source: "comp"` rather than writing `user.plan` and desynchronising it from the subscription that owns it.

---

## 11. Engineering plan

Ordered by dependency, in the style of `PLAN.md` §24.

### B1 — Catalog, prices, entitlements (1 day)
**Build:** `src/lib/billing/catalog.ts` (`PlanId`, `Entitlements`, spend caps) · `prices.ts` (the §3 table, `resolveCurrency`) · `entitlements.ts` (the §5 resolver).
**Dep:** none. No database, no network.
**Accept:** every branch of the resolver covered by a unit test · a grant resolves to Pro entitlements at the trial cap · `cancelAtPeriodEnd` keeps entitlements until `currentPeriodEnd` · `past_due` keeps them one cycle then drops.

### B2 — Schema and store (1 day)
**Build:** `src/db/schema/billing.ts` (six tables) · export from the barrel · `pnpm db:generate` → `drizzle/0016_*` · `src/lib/billing/store.ts` · `PROTECTED_UPDATE_COLUMNS` grows.
**Dep:** B1.
**Accept:** `pnpm db:migrate` runs clean on an empty database · `pnpm console:role` regenerated · the console role cannot `update user.plan` or `subscription.status` · every FK cascades from `user`.

### B3 — Quota and the spend-cap fixes (1 day)
**Build:** `quota.ts` `consumeEvaluation` · wired into `src/lib/submissions/project.ts` · `SPEND_CAP_CENTS` moved into the catalog · plan threaded into `evaluateSubmission` from `src/lib/inngest/functions.ts` · the hardcoded `plan: "free"` replaced · `src/lib/admin/console.ts`'s SQL case grown.
**Dep:** B2.
**Accept:** **two concurrent submissions at a limit of 1 produce exactly one success** · a free account is refused its second evaluation in a month, at creation, with no Inngest job enqueued · `quota_reached` fires · marking now degrades at the cap where it previously never did.

### B4 — Stripe adapter (1.5 days)
**Build:** `stripe/{client,checkout,webhook,portal}.ts` · `MemoryBilling` · `resolveBilling()` · the §3 price assertion · `.env.example` Billing block.
**Dep:** B2.
**Accept:** the suite runs with **no Stripe keys set** and full coverage · a deliberately mismatched price throws rather than charging · a key without a webhook secret throws at resolve time with an actionable message.

### B5 — Webhook (1 day)
**Build:** `src/app/api/billing/webhook/route.ts` · signature verification over raw bytes · `billing_event` idempotency · `user.plan` reconciliation · the eight event handlers.
**Dep:** B4.
**Accept:** a tampered body is rejected · **the same event delivered twice changes exactly nothing** · `user.plan` tracks `subscription.status` through trial → active → past_due → cancelled → refunded.

### B6 — Surfaces (2 days)
**Build:** `/pricing` (+ sitemap, `AggregateOffer`, currency island) · `startCheckoutAction` · `/account/billing` · cancellation + the mandatory exit survey.
**Dep:** B5.
**Accept:** the amount rendered on `/pricing` **byte-matches** the created Checkout Session amount, in both currencies · the page stays statically rendered · `curl` confirms metadata ahead of body content (§13.1) · cancellation cannot complete without a reason.

### B7 — Emails, analytics, admin (1 day)
**Build:** six catalog emails × four locales · the eleven analytics events · four-plan admin select · `HUMAN-REVIEW.md` part D amended.
**Dep:** B5.
**Accept:** every new email renders in `en`/`de`/`bg`/`es` in a snapshot test · a missing locale key fails `pnpm typecheck` · the admin select sets any of the four plans.

### B8 — Referral, E14 (2 days)
**Build:** `referral/{code,attribute,reward,abuse,store}.ts` · `/r/[code]` · the `databaseHooks.user.create.after` hook · reward on `invoice.paid` · revoke on refund · `/account/referrals`.
**Dep:** B5, B7.
**Accept:** **a Google OAuth signup is attributed** (the path the sign-up action does not cover) · a self-referral via a `+tag` alias is rejected and recorded · no grant exists before `firstPaymentAt` · a refund revokes both grants · `/r/{code}` is absent from the sitemap and disallowed in `robots.txt`.

**Total: ~10.5 engineering days.** If time is short, cut **B8** — referral is growth, and growth without revenue is nothing. **Never cut B3** (the quota is the meter and two of its fixes are live bugs) or the §3 price assertion (correctness).

---

## 12. Tests

`AGENTS.md` is not negotiable here: 100% of `src/` on lines, functions, branches and statements, tests in the same change as the feature, no new `coverage.exclude` entries, no `c8 ignore`, `pnpm verify` clean before every commit. Most of this plan is pure functions over rows, which is unusually easy to test.

| Area | Test |
|---|---|
| Catalog | Every plan resolves; no plan is missing an entitlement key |
| Prices | Every `(plan, interval, currency)` has an amount and a price-ID env name; annual is 33% off monthly in both currencies |
| Currency | `en`→USD, `de`/`es`/`bg`→EUR; the cookie overrides; a subscription's locked currency beats both |
| Entitlements | The full §5 precedence matrix as a fixture table — grant, active, `cancelAtPeriodEnd`, `past_due` in and out of window, none |
| **Quota** | **Two concurrent `consumeEvaluation` calls at limit 1 → exactly one success** · rollover at a month boundary · limit 0 refuses immediately |
| Spend cap | Each of the four plans degrades at its own ceiling; the evaluation path now passes a plan |
| Price integrity | Page amount == checkout amount, both currencies; a mismatch throws |
| Webhook signature | Valid · tampered body · stale timestamp · missing header · wrong secret |
| Webhook idempotency | The same `stripeEventId` twice leaves the database identical |
| Lifecycle | trial → active → past_due → cancelled → refunded, asserting `user.plan` at every step |
| Referral attribution | Email signup · **Google OAuth signup** · no cookie · expired cookie · unknown code |
| Referral abuse | Every §9.3 row, including `+tag` and dotted Gmail aliases |
| Referral reward | No grant before payment · grant on `invoice.paid` · revoke on refund · revoke on dispute |
| Emails | Six templates × four locales render; a missing key fails typecheck |
| `/pricing` | Renders four plans; one filled button; `AggregateOffer` parses; present in the sitemap |
| Cancellation | Cannot complete without a reason; writes the survey row; sets `cancel_at_period_end` |

**Every new DB-touching file must be added to `DATABASE_TESTS` in `vitest.config.ts`** or it races the shared Postgres — the config's docblock explains why at length. Namespace rows by email suffix and delete them in `beforeEach`, as the mail suites do.

---

## 13. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Stripe means we own EU VAT** — `PLAN.md` §18.1 chose a MoR precisely to avoid this | 🔴 Critical | Below the **€10,000/yr** EU-wide threshold for cross-border B2C digital services, home-country VAT applies and this is simple. Above it: OSS registration, destination rates, quarterly returns, 10-year records. **Stripe Tax calculates; it does not file.** Confirm the Bulgarian specifics with an accountant once, and set a calendar reminder at €8,000 trailing-twelve-month cross-border EU revenue |
| 2 | **The trial loses money at low conversion** | 🟠 High | Breakeven ~11% trial→paid. The 500¢ trial cap bounds the downside per taker at ~$5. Instrument `checkout_started → subscription_created` from day one and kill the €3 offer if conversion sits under 10% over ≥100 trials |
| 3 | **A renewing trial produces chargebacks** | 🟠 High | Day-3 email stating the date and the amount · the renewal terms restated at checkout · Stripe's own trial-ending email left on · one-click cancel in the portal. A chargeback costs the fee plus $15 and threatens the account |
| 4 | **Referral farming** | 🟠 High | §9.3's five rules, from the first commit. Reward only after payment; revoke on refund; grants carry the trial cap so a farmed grant is worth ~$5 of inference, not $15 |
| 5 | **Four tiers on one page depress conversion** — §20.1's stated objection | 🟡 Medium | Accepted deliberately (§1 decision 4). Instrument per-plan `checkout_started`; if Learner takes <5% of starts it is decoration and should be moved to the cancellation flow |
| 6 | **Learner cannibalises Pro** | 🟡 Medium | The gap is the meter: 3 evaluations vs 10. Watch the Learner→Pro upgrade rate and the share of Learner accounts hitting their quota; a high quota-hit rate at a low upgrade rate means the gap is priced wrong |
| 7 | **`user.plan` desynchronises from `subscription`** | 🟡 Medium | Exactly one function reconciles it, called only from the webhook. Admin comps go through `plan_grant`, never a direct write. A nightly reconciliation job is the fallback if drift is ever observed |
| 8 | **The trial's Stripe mechanics do not behave as documented** | 🟡 Medium | §15 step 3 verifies it in test mode **before** B6 depends on it. If `add_invoice_items` does not bill immediately, fall back to a one-off €3 Payment Intent plus a scheduled subscription |
| 9 | **Six more emails × four locales stalls launch** | 🟡 Medium | Flagged into `HUMAN-REVIEW.md` part D with its status changed from "not urgent" to launch-gating for `de`/`es`/`bg`. English ships regardless; a locale without billing copy does not open |
| 10 | **Charm prices contradict two written plans** | 🟢 Low | Amend §20.1 and `PLAN-LOCALIZATION` §6.1 in the same change (§11 B-list step 10 of the approved plan). One canonical table, in `prices.ts`, with the documents pointing at it |

---

## 14. Decide-or-drop criteria

Measured **90 days after the pricing page goes live**, in the spirit of `PLAN.md` §17.3 — pre-committed, not argued about later. §17.3's own free→paid criterion (kill <2%, continue >5%) still governs; these are the ones this plan adds.

| Signal | Drop it | Hold | Invest further |
|---|---|---|---|
| Trial→paid conversion | <10% — **the €3 offer loses money** | 10–25% | >25% |
| Share of checkout starts choosing Learner | <5% — move it to cancellation only | 5–20% | >20% — the price ladder is right |
| Referral share of new signups | <2% — stop maintaining it | 2–10% | >10% — build the §9.4 tiers |
| Rewarded referrals rejected for abuse | >20% — tighten or withdraw | 5–20% | <5% |
| Annual share of new paid subscriptions | <10% | 10–30% | >30% |
| Chargeback rate | >0.5% — **the trial renewal is the suspect** | 0.1–0.5% | <0.1% |

---

## 15. Verification

Run in order. Nothing here is assumed to work.

| # | Component | How to confirm it |
|---|---|---|
| 1 | The suite | `docker compose up -d`, then `DATABASE_URL=postgres://online_uni:online_uni@localhost:5433/online_uni pnpm verify`. **Without `DATABASE_URL` exported the DB tests skip and coverage reports ~96.5% — a misconfigured run, not a regression** |
| 2 | Migration | `pnpm db:migrate` on a clean database, then `pnpm console:role` |
| 3 | **The trial** | Stripe test mode: create the prices, run a checkout, confirm **€3 charged immediately and a €24.99 renewal scheduled 4 days out**. The one mechanic asserted from docs rather than measurement |
| 4 | Lifecycle | `stripe listen --forward-to localhost:3000/api/billing/webhook` — trial start → convert → payment failed → cancel → refund. `user.plan` tracks every step; **replaying an event twice changes nothing** |
| 5 | Price integrity | Integration test: `/pricing` amount == Checkout Session amount, USD and EUR |
| 6 | Quota | Free account, submit twice. The second is refused at creation with an upgrade prompt, `quota_reached` fires, no Inngest job enqueued |
| 7 | Referral | `/r/{code}` in a clean profile → sign up **with Google** → referee grant exists → pay → referrer's 14 days exist. Then refund and confirm both revoke |
| 8 | Self-referral | A `+tag` alias of the referrer's own address is rejected and the reason recorded |
| 9 | SEO | `curl -s localhost:3000/pricing \| head -c 2000` — title, description, canonical and `og:*` ahead of `<body>`, per §13.1's check (which landed at bytes 1504–1883 on the existing marketing pages) |
| 10 | Static rendering | `next build` — `/pricing` still static; the currency island did not flip it to dynamic |

---

## Open questions

Four, and only the first blocks anything.

1. **Does the free tier keep its 1 evaluation/month?** This plan assumes **yes**, unchanged from §20.1, because §19.3's single activation metric is *"first graded submission within 7 days of signup"* and §17.3's day-60 kill criteria are measured against it. Putting graded work behind the €3 trial would make a low activation number ambiguous — wrong product, or €3 of friction? It is one row in the catalog if the answer is no.
2. **Does Learner get premium models?** This plan says standard, making the Learner→Pro gap *depth and intensity* as the brief's §7 asks. If Learner feels visibly worse rather than merely smaller, the gap is in the wrong place — it is one boolean in the catalog.
3. **When does multi-goal get built?** §2 explains why no plan can currently claim it. The brief sells 3 goals on Learner and unlimited on Pro, and both are engine work rather than billing work. Until it exists, `/pricing` has one fewer axis to differentiate on than the brief assumed.
4. **What is the annual discount claim?** €199 against €24.99×12 is **33%**, not §20.1's 37%. `annualSavingPercent()` computes it and rounds down, so the page cannot overstate it — but the marketing copy elsewhere must agree.
