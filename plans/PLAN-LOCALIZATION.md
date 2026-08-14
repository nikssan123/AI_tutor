# Localization Plan — German, Bulgarian, Spanish · EUR and USD · geo-derived defaults

Companion to `PLAN.md`. Nothing here is appended to that document; where the two disagree, this one wins **for locale, currency and geo concerns only**.

## 0. What this replaces, and the honest framing

`PLAN.md` §10 specifies **one** local-language beachhead, in month 4, after the English cluster shows traction, with §26 risk #12 naming the exact failure mode: *"the local-language beachhead fragments effort."* The mitigation there was "one language, translate only proven pages, kill it if English hasn't worked."

This plan takes on **three** languages instead of one. That is three times the surface the main plan deliberately deferred, so the risk it named gets three times larger — unless the work is split the way §2 splits it. The split is the whole point:

| Layer | Cost | Compounding risk | Verdict |
|---|---|---|---|
| **Currency (EUR/USD) + geo detection** | ~2 days, once | None — no ongoing content burden | **Ship early.** It is a revenue lever, not a content commitment. |
| **Product UI in 3 languages** | ~5 days + ~€600 review, then ~2h per feature forever | Low, but permanent: every new string is now four strings | **Ship as one unit**, with the string-completeness gate in §13 |
| **SEO content in 3 languages** | Unbounded | **This is the trap risk #12 named** | **Gated per locale on evidence** (§15). Bulgarian first, because it is the only one the founder writes natively. |

**The one-sentence rule for the whole document:** *the URL decides the language, geo only suggests it, and the price shown must be the price charged.*

---

## 1. Decisions

| # | Decision | Call |
|---|---|---|
| 1 | Locales | `en` (default), `de`, `bg`, `es` |
| 2 | Spanish variant | **Neutral `es`**, no region code. Avoid *vosotros* and Iberia-only vocabulary; prefer terms that read correctly in both Spain and Latin America |
| 3 | URL shape | English at the root (`/learn/sql`), others prefixed (`/de/learn/sql`). `/en/*` 301s to `/*` |
| 4 | Locale source of truth | The URL, for anything crawlable. The `user.locale` column, for anything authenticated |
| 5 | Geo → language | **Suggestion only.** A dismissible banner, never an automatic redirect for a first-time visitor |
| 6 | Geo → currency | **Europe (EEA + UK + CH) → EUR, everywhere else → USD.** Two currencies, no third, no runtime FX conversion |
| 7 | Bulgaria | **EUR, not BGN** — Bulgaria adopted the euro on 2026-01-01 (§6.4 has the verification step) |
| 8 | EU price display | **VAT-inclusive**, as EU consumer law requires. €25/mo is the gross price, not the net |
| 9 | AI output language | Tutor, lessons and evaluation commentary follow the learner's locale. **Rubrics are graded in English internally**; only their display is translated |
| 10 | Evidence quotes | **Always verbatim, in the artefact's own language, never translated** — the verifier does substring matching (§8.3) |
| 11 | Pack content | Item banks and rubrics are locale-scoped rows with **independent calibration**. A translated item is a new item statistically |
| 12 | Machine translation | Fine for the product UI pre-review. **Never indexable.** An SEO page ships in a language only after a native speaker has read it |

---

## 2. Surface inventory — what gets translated, and when

| Surface | `de` | `bg` | `es` | Phase | Notes |
|---|---|---|---|---|---|
| Product UI (all `(app)` + `(marketing)` chrome) | ✅ | ✅ | ✅ | L3 | ~600 strings at current scope |
| Transactional email (verify, reset, daily nudge, weekly digest, eval-ready) | ✅ | ✅ | ✅ | L3 | Keyed on `user.locale` at send time |
| Tutor, lesson content, session blocks | ✅ | ✅ | ✅ | L4 | Prompt-level, no translation files |
| Evaluation commentary and next actions | ✅ | ✅ | ✅ | L4 | Rubric criteria names translated for display only |
| Rubric library (internal grading text) | ❌ | ❌ | ❌ | — | **Stays English by design.** Translating it re-opens calibration |
| Assessment item banks | ⚠️ | ⚠️ | ⚠️ | L5 | Per-pack, per-locale, recalibrated. Not all packs, not at once |
| SEO pages (`/learn`, `/projects`, `/check`) | 🔒 | ✅ | 🔒 | L6 | 🔒 = built but `noindex` until a native review happens (§10.3) |
| Legal (terms, privacy, refunds) | ✅ | ✅ | ✅ | L6 | Reviewed, not machine-translated. Consumer-facing legal text is not a place to save €200 |
| OG / social images | ❌ | ❌ | ❌ | — | English only, consistent with `PLAN.md` §8.5.4's single-theme carve-out |
| Marketing copy on `/` | ✅ | ✅ | ✅ | L6 | The headline is the hardest string in the product to translate; budget a real reviewer for it |

---

## 3. Locale model

```ts
// src/lib/i18n/locales.ts
export const LOCALES = ["en", "de", "bg", "es"] as const;
export const DEFAULT_LOCALE = "en";
export type Locale = (typeof LOCALES)[number];
```

- **Region-less codes.** `de` not `de-DE`, because we serve Austria and Switzerland the same German. `es` not `es-ES`, per decision 2.
- **`hreflang` values** are the same four codes plus `x-default` → the English URL.
- **Formatting** uses `Intl` with the locale code directly (`Intl.NumberFormat("de", …)`). Number and date formats come from `Intl`, never from hand-written format strings.
- **Not a locale:** currency. A German in the US sees German text and USD prices. Language and currency are two independent axes and the code must never conflate them — this is the single most common i18n bug and it is trivially avoidable by keeping them in separate cookies.

---

## 4. Routing and rendering

### 4.1 This is Next.js 16.3 — two things differ from what you may remember

Verified in `node_modules/next/dist/docs`:

1. **`middleware.ts` is deprecated and renamed to `proxy.ts`** (`01-app/03-api-reference/03-file-conventions/middleware.md`). The exported function is `proxy`, not `middleware`. There is a codemod: `npx @next/codemod@canary middleware-to-proxy .`
2. **`NextRequest.geo` and `NextRequest.ip` were removed in v15** (`04-functions/next-request.md`). Geo arrives as request headers from the platform — on Vercel, `x-vercel-ip-country`. There is no built-in geo object to reach for.

Also new and worth using: **`next/root-params`** exports a `lang()` getter, so any Server Component or server-side utility can read the locale without prop-drilling `params` through every layer — but only if `[lang]` sits **above the root layout**.

### 4.2 Route structure

```
src/app/
├─ [lang]/                       # root param — enables next/root-params lang()
│  ├─ layout.tsx                 # root layout for the crawlable world; <html lang={lang}>
│  ├─ page.tsx                   # /
│  ├─ learn/[topic]/page.tsx     # generateStaticParams × 4 locales
│  ├─ projects/[slug]/page.tsx
│  └─ check/[topic]/[skill]/page.tsx
│
├─ (app)/layout.tsx              # second root layout; locale from user.locale, not the URL
├─ admin/ · design/ · api/       # locale-free, noindex, English only
├─ sitemap.ts · robots.ts
└─ proxy.ts                      # locale rewrite/redirect + geo headers
```

**Cost of this shape, stated plainly:** making `[lang]` a root param means the app segment needs its own root layout, so `src/app/layout.tsx` splits in two and the theme script from `PLAN.md` §8.5.4 is shared through a component rather than a file. Crossing between the two roots is a full page load — acceptable, because marketing → app is already a hard boundary.

**If that refactor looks too expensive mid-build:** keep the single root layout, put `[lang]` under `(marketing)`, and pass `params.lang` explicitly instead of using `root-params`. Everything else in this plan is unchanged. Explicit params are marginally more verbose and marginally easier to test.

### 4.3 The proxy

```
Incoming request
  ├─ path starts with /de|/bg|/es  → pass through
  ├─ path starts with /en          → 301 to the same path without /en
  └─ otherwise                     → rewrite (not redirect) to /en + path
```

Plus, on every request: read `x-vercel-ip-country`, normalise it, and set a `ou_country` cookie if absent.

**The rules that keep this from wrecking SEO:**

- **A cookie-less visitor is never redirected by language.** Googlebot has no cookies, so it is crawler-safe by construction rather than by user-agent sniffing — which is cloaking-adjacent and which we do not do.
- **English is a rewrite, not a redirect.** `/learn/sql` stays `/learn/sql`; the existing indexed URLs and every internal link in the DB keep working.
- **`/en/learn/sql` must 301 away**, or the same page is reachable at two URLs and we have manufactured duplicate content on day one.
- **A returning visitor who explicitly chose a language** (cookie `ou_locale` present, set only by the language switcher or the banner) is redirected on `/` only, once, with `Vary: Cookie`.

### 4.4 Static rendering is preserved

Every marketing route stays `generateStaticParams` + ISR, now multiplied by four locales. `PLAN.md` §13.3's budgets (LCP <2.0s, CLS <0.05, <80KB JS on marketing) are unchanged and still enforced.

**The trap to avoid:** calling `headers()` or `cookies()` in a marketing page opts that route into dynamic rendering and silently destroys the static build. Locale comes from the URL segment. Country comes from a cookie read **in a client island** (§6.5), never from a server-side header read on a static page.

---

## 5. Geo detection

### 5.1 Signal precedence

For **language**, highest wins:

1. Explicit URL prefix (`/de/…`)
2. `ou_locale` cookie — set only by an explicit user action or, once signed in, from `user.locale`
3. `Accept-Language`, negotiated against our four locales
4. Country → language map (DE/AT/CH → `de`; BG → `bg`; ES/MX/AR/CO/CL/PE → `es`)
5. `en`

For **currency**, highest wins:

1. An active subscription's currency — **immutable for the life of that subscription** (§6.3)
2. `ou_currency` cookie, set by the manual switcher
3. Country from `x-vercel-ip-country`: EEA + UK + Switzerland → EUR, else USD
4. USD

Note that `Accept-Language` outranks geo for language but geo outranks everything for currency. That asymmetry is deliberate: a browser language is a stated preference about reading, and it says nothing about where the person pays tax.

### 5.2 Privacy

- The IP address is **read at the edge and never stored**. We persist a two-letter country code, nothing finer. No IP in logs, no IP in the analytics envelope, no third-party geo-IP service call.
- `ou_locale`, `ou_country`, `ou_currency` are functional cookies with no cross-site identifier in them. They are strictly necessary for delivering the requested service in the right language and currency, so they need no consent banner — but the privacy policy must say, in one plain sentence, that the country is derived from the connection and not retained. (`PLAN.md`'s own copy rule from memory applies: state the consequence, not the mechanism.)

### 5.3 Making it testable

Geo headers do not exist locally, and a test that depends on real network conditions is not a test. Ship a resolver with an explicit override:

```ts
// src/lib/i18n/geo.ts
export function countryFrom(headers: Headers, env = process.env): string | null
```

which reads `x-vercel-ip-country`, falls back to `x-ou-country` (honoured only when `NODE_ENV !== "production"` or a dev flag is set), and returns `null` rather than guessing. Everything downstream is a pure function of that string, so the whole geo path is unit-testable with no mocking of the platform.

---

## 6. Currency and pricing

### 6.1 The price table

`PLAN.md` §20.1 sets Pro at **$25/mo or $190/yr**. The EUR prices mirror it rather than converting it — round local numbers beat FX-derived ones, and a price is a positioning signal, not an exchange calculation.

| Tier | USD | EUR | Note |
|---|---|---|---|
| Free | $0 | €0 | No currency shown at all |
| **Pro monthly** | **$25** | **€25** | EUR price is **VAT-inclusive** |
| **Pro annual** | **$190** | **€190** | Same 37% discount framing |
| Later tier (post-PMF) | $49 | €49 | Unchanged from §20.1 |

### 6.2 What VAT-inclusive display costs, stated honestly

EU consumer law requires prices shown to consumers to include VAT. At €25 gross, with the Merchant of Record taking ~4% of gross:

| Market | VAT | Net of VAT | Net after MoR | vs. US |
|---|---|---|---|---|
| Germany | 19% | €21.01 | **€20.01** | −10% |
| Spain | 21% | €20.66 | **€19.66** | −11% |
| Bulgaria | 20% | €20.83 | **€19.83** | −11% |
| United States | added on top by the MoR | $25.00 | **$24.00** (≈€22.20) | — |

*(FX shown at ~1.08 USD/EUR for comparison only — nothing in the product converts currencies at runtime.)*

Against `PLAN.md` §20.2's average AI cost of ~$4.80/mo (≈€4.45), a German Pro subscriber yields **~78% gross margin** versus 80% in the US. Blended margin moves from ~77% to ~76%.

**The alternative, rejected:** price the EU at €29 gross to equalise net revenue. It equalises the maths and loses the positioning — €29 reads as "more expensive than the American price" to anyone who compares, and this product's price already sits deliberately in Duolingo Max's psychological band. Two points of margin is a cheaper thing to give up than the price anchor.

### 6.3 The rules that prevent billing bugs

1. **The displayed price must equal the charged price.** If the pricing page shows €25 and checkout charges $25, that is a P0 bug, not a rounding difference. The checkout session is created server-side from the same resolver the page used.
2. **Currency is locked at first subscription** and never changes for that subscription. Polar and Paddle both treat currency as immutable per subscription; a user who moves country keeps their currency until they cancel and resubscribe. Say this in the FAQ in one line rather than letting support discover it.
3. **Never display two currencies at once.** One price, one currency, one manual switcher.
4. **The MoR owns tax.** `PLAN.md` §18.1 already chose a Merchant of Record precisely so VAT is not hand-rolled; that decision now carries three more VAT rates and does so for free. Configure USD and EUR price sets in the MoR dashboard and read the resolved amount back — do not hard-code prices in two places.

### 6.4 Bulgaria specifically

Bulgaria adopted the euro on **2026-01-01**, so the lev is not a currency this product needs to support: Bulgarian learners are EEA and see EUR like any other euro-area customer, at 20% VAT.

**Verify before the pricing page ships** (one search, five minutes, and it is load-bearing for a whole locale):
- That the dual BGN/EUR price-display obligation, which ran through the changeover period, has in fact lapsed. If it has not, show the BGN equivalent at the fixed conversion rate **1.95583 BGN/EUR** as secondary text — that rate is fixed by law, not a market rate, and must not be fetched from an FX API.

### 6.5 Rendering a price without breaking the static build

The pricing page is statically generated per locale, and the static HTML cannot know the visitor's country. Resolution:

- The static HTML carries the **locale-implied currency** — `en` → USD, `de`/`bg`/`es` → EUR. That is correct for the overwhelming majority of readers and it is what crawlers see.
- A small client island reads `ou_country` / `ou_currency` and swaps only on a genuine mismatch (an American reading `/de`, a Swiss reading `/de`). The price slot has a **fixed width reserved**, so a swap costs no layout shift and §13.3's CLS <0.05 budget survives.
- The switcher writes `ou_currency`, and checkout reads the same cookie. One source, two readers, no divergence.

### 6.6 Purchasing power — measure, do not guess

€25/mo is a materially heavier price in Sofia than in Munich, and USD $25 is heavier again in Mexico City or Bogotá than in Chicago. Regional price sets are supported by both candidate MoRs, so this is a pricing decision rather than an engineering one.

**Do not ship regional pricing at launch.** Ship one EUR price and one USD price, instrument `checkout_started → subscription_created` **by country**, and add a country price set only when that conversion rate is below half the German rate over ≥50 checkouts. Discounting before there is evidence throws away margin and teaches nothing.

---

## 7. Translation pipeline

### 7.1 Catalogue format

Plain JSON dictionaries per the Next.js guide, loaded server-side, one file per locale:

```
src/lib/i18n/dictionaries/{en,de,bg,es}.json
```

- `en.json` is the **source of truth and the type**: `type Dictionary = typeof en`, so a missing key in `de.json` is a **typecheck failure**, not a runtime `undefined` in front of a user. This is the single highest-value line in the whole i18n setup.
- Dictionaries are imported dynamically and only ever on the server, so they never enter the client bundle — §13.3's <80KB marketing JS budget is unaffected by adding languages.
- Plurals and interpolation go through `Intl.PluralRules` / `Intl.NumberFormat`. No template-string concatenation of translated fragments: German and Bulgarian put words in different orders and concatenation produces sentences no reviewer can fix.

### 7.2 Who translates what

| Content | Method | Reviewer | Est. cost |
|---|---|---|---|
| Product UI, ~600 strings | Claude, then reviewed | Native freelancer, one pass per language | ~€200 × 3 |
| Bulgarian everything | **Written natively by the founder** | — | €0 |
| German / Spanish marketing copy | Claude draft → native reviewer | Native freelancer | ~€150 × 2 |
| German / Spanish SEO pages | Claude draft → native reviewer, per batch of 15 | Native freelancer | ~€300–500 per batch |
| Legal pages | Professional translation | — | ~€400 total |

`PLAN.md` §10's selection criterion for the beachhead was *"you write it natively."* Only Bulgarian satisfies it. German and Spanish are therefore **paid-review locales**, and the honest consequence is in §10.3: their SEO pages stay `noindex` until someone who speaks the language has read them. The DB already defaults `seoPage.indexable` to `false`, so this rule is enforced by the schema that exists rather than by discipline.

---

## 8. The AI layer in four languages

### 8.1 Output language

Every learner-facing generation — goal interview, lesson blocks, tutor turns, evaluation commentary, capability statements, weekly reflection — takes the locale as an explicit prompt variable and responds in it. This is a prompt change, not a translation pipeline.

**Cache implications:** `PLAN.md` §14.9.4 caches a learner-context prefix. Locale must sit in the cached prefix, not be appended after it, or the cache key changes per turn and cost triples silently. The existing test asserting `cache_read_input_tokens > 0` on the second tutor turn should be parameterised over locales.

### 8.2 Rubrics are graded in English

A rubric's criteria, bands and weights stay in English inside the evaluation prompt. Only the **display** of criterion names and descriptions is translated.

Why: `PLAN.md` §21 identifies rubric calibration as the strongest moat, and §26 risk #1 makes κ ≥ 0.6 a launch gate. Translating the grading text creates four rubric variants whose agreement with each other is unknown and whose calibration data cannot be pooled. Grading in one language and reporting in another keeps a single calibration corpus.

### 8.3 Evidence quotes must never be translated

`PLAN.md` §14.5 requires every criterion score to quote the artefact, and the verification table has a test that **injects a submission the model cannot quote correctly and asserts the verifier rejects it**. That verifier does substring matching against the artefact.

So: if a German learner submits German prose and the model renders its evidence quote translated into the UI language — or worse, into English — **the substring check fails and a correct evaluation gets rejected**. This is the most likely way localization breaks the product's core feature, and it will look like a flaky evaluator rather than an i18n bug.

**Rule:** quotes are verbatim in the artefact's own language; commentary around them is in the learner's locale. **Test:** a German artefact, evaluated with `locale: "de"`, asserts every returned quote is a literal substring of the submitted text. Same for Bulgarian and Spanish. This test is not optional.

### 8.4 Item banks and calibration

`AssessmentItem` carries `difficulty` (theta) and `discrimination` — parameters fitted from response data. **A translated item is a different item**: translation changes reading load, ambiguity and sometimes the answer.

- Add `locale` to `AssessmentItem`, unique on `(packId, skillId, locale, slug)`.
- A translated item **inherits the English parameters as priors only**, flagged `calibrated: false`, and is re-estimated after N responses (start at N = 30).
- The diagnostic's max-information item selection must filter by locale. An uncalibrated item may be served but must not be the sole basis for a placement decision.
- **Not every pack goes multilingual.** Start with the **Curated** packs only — the ones a person has already read end to end — and only in Bulgarian, where the founder can check the translation is right. German and Spanish item banks wait for evidence of demand in those locales. (Stated as a rule rather than a list: this line named three packs and there are seven.)
- **Localising the product is not the same as teaching a language.** This plan puts the *interface* and the SEO surface into Spanish, German and Bulgarian. It does not add language-learning subjects — those are declined in `src/lib/content/categories.ts`, and the two decisions are independent: a Spanish speaker learning SQL is exactly who this plan is for.

### 8.5 Cost — Cyrillic is not free

Tokenizers are trained predominantly on Latin-script text. Bulgarian consumes materially more tokens per character than English; German and Spanish somewhat more. Rough working estimates, **to be replaced with measured numbers**:

| Locale | Est. tokens vs. English | Est. session cost (§20.2 baseline $0.17) |
|---|---|---|
| `en` | 1.0× | $0.17 |
| `es` | ~1.15× | ~$0.20 |
| `de` | ~1.2× | ~$0.21 |
| `bg` | **~1.8–2.2×** | **~$0.32–0.37** |

**Measure it, do not assume it:** add `scripts/locale-token-probe.ts` alongside the existing probe scripts, run the same session and evaluation prompt in all four locales against the real API, and record actual token counts. If Bulgarian lands above 2×, the per-user spend cap from §14.9.7 needs to be locale-aware or Bulgarian heavy users quietly become the worst-margin cohort in the product.

---

## 9. Design and typography consequences

### 9.1 The font does not currently support Bulgarian

`src/styles/globals.css` declares Instrument Sans with `unicode-range: U+0000-00FF, …` — Latin only. Cyrillic (U+0400–04FF) is **not in the range**, so every Bulgarian page would silently fall back to a system font and look like a different product.

German (ä ö ü ß) and Spanish (ñ á é í ó ú ¿ ¡) are inside Latin-1 and need no change.

**Do this:**
1. Verify whether the Instrument Sans variable file even contains Cyrillic glyphs (`pyftsubset` / `fc-query`, or check the Google Fonts subset list). It very likely does not.
2. If it does not, pick a Cyrillic-capable companion that pairs credibly and load it **only for `bg`**, scoped by `unicode-range` so Latin pages never download it.
3. **Bulgarian Cyrillic has its own letterforms.** б, г, д, и, п, т, ц and ш are drawn differently from Russian Cyrillic, and the correct forms are selected by the `locl` OpenType feature keyed on `lang="bg"`. Since `<html lang>` is already per-locale under `[lang]`, this works for free — **if the chosen font ships the Bulgarian `locl` set.** Make that a selection criterion, not a discovery.
4. The metric-matched `Instrument Sans Fallback` needs a Cyrillic-metric equivalent, or CLS regresses on Bulgarian pages only — invisible in a Latin-only screenshot suite.

*(Aside, unrelated to locale: `public/fonts/instrument-sans-variable.woff2` does not exist in the repo — the `@font-face` currently points at nothing.)*

### 9.2 German expands, and the density rule is a real constraint

German UI strings run 20–35% longer than English. `PLAN.md` §8.5.1's five-items-at-rest density rule and §8.5.5's "one filled button per screen, full-width on mobile" absorb this well — but fixed-width buttons, single-line labels and the three-item bottom nav will not.

- Every visual-regression snapshot runs in **`de` as well as `en`** — German is the width stress test, exactly as dark mode is the colour stress test.
- `hyphens: auto` with the correct `lang` attribute, which the `[lang]` root param already provides.
- The `/design` route renders its specimens in all four locales so drift is visible in one place.

### 9.3 Small things that are always got wrong

- **No flags for languages.** A flag is a country; Spanish is not Spain. Use language names in their own language: `Deutsch · Български · Español · English`.
- Dates, numbers, currency: `Intl` only, with the locale passed explicitly. Never `toLocaleString()` with no argument — it silently uses the server's locale and produces different output in CI than in production.
- The language switcher lives in the footer on marketing and in Settings → Language in-app, mirroring §8.5.4's placement rule for the theme control. It is a once-a-visit action and does not earn permanent chrome.

---

## 10. SEO

### 10.1 hreflang

Every translated page emits a **reciprocal, complete** cluster including `x-default` → the English URL. Non-reciprocal hreflang is ignored by Google, which is the most common way this work produces zero benefit.

```ts
// src/lib/site.ts — extend the existing canonical() helper
export function canonicalFor(locale: Locale, path: string): string
export function alternatesFor(path: string): { languages: Record<string, string>; canonical: string }
```

`generateMetadata` on every marketing route spreads `alternatesFor(path)` into `alternates`. `tests/lib/site.test.ts` already exists — the reciprocity assertion goes there.

### 10.2 Sitemap

`src/app/sitemap.ts` currently emits one entry per page from `packPages()` and `indexablePages()`. Each becomes one entry per **indexable** locale, with `alternates.languages` populated.

The existing rule holds and gets more important: **only `indexable: true` pages appear.** Four locales is four times the crawl budget, and a machine-translated page in the sitemap is precisely the scaled-content signal §12 exists to avoid.

### 10.3 Which pages ship in which language

| Stage | Locale | Pages | Indexable? |
|---|---|---|---|
| L6a | `bg` | The 15 best-performing English pages, translated by the founder, **plus 5 written natively for Bulgaria** (local job market, local salaries, local employer expectations) | ✅ |
| L6b | `de`, `es` | Same 15, machine-drafted | ❌ `noindex` until a native reviewer passes them |
| L6c | `de`, `es` | Reviewed batch | ✅ one batch at a time, gated on §15 |

`PLAN.md` §10's finding stands unchanged and is the reason for this ordering: **translations alone rarely rank.** The locale-native pages are what earn Bulgarian traffic; the translated ones support them.

### 10.4 Monitoring

Add a locale dimension to the §25 analytics envelope (which already carries `locale`) and to the GSC review: impressions, clicks and average position **per locale**, checked weekly. A locale that produces impressions but no clicks has a translation quality problem, not a ranking problem, and the two need different fixes.

---

## 11. Data model changes

Additive only; no destructive migration.

| Table | Change | Why |
|---|---|---|
| `user` | `locale` **already exists** (default `"en"`) — set it at signup from the detected locale instead of leaving the default | Emails and app UI need it before the user visits Settings |
| `user` | add `country` (2-char, nullable) | Currency resolution and per-country conversion analysis. Country only — never the IP |
| `subscription` (new, at E13) | `currency` (`"usd"` \| `"eur"`), immutable | §6.3 rule 2 |
| `seoPage` | `locale` **already exists**, with `unique(slug, locale)` — add `translationGroupId` | hreflang clusters need to know which rows are translations of each other |
| `assessmentItem` | add `locale`, `calibrated` (bool) | §8.4 — translated items calibrate independently |
| `rubric` | **no change** | §8.2 — rubrics stay English |
| `interaction`, `agentRun` | add `locale` | Cost per locale (§8.5) is not answerable without it |

---

## 12. Engineering plan

Ordered by dependency, in the style of `PLAN.md` §24. Estimates assume the solo-founder pace already assumed there.

### L1 — Currency and geo (2 days) — *ship this first, independent of language*
**Build:** `proxy.ts` reading `x-vercel-ip-country` · `src/lib/i18n/geo.ts` with the test override · country → currency resolver (EEA table) · `ou_country` / `ou_currency` cookies · `Money` display component with reserved width and the client-side swap island.
**Accept:** an EEA country header yields EUR and a US one USD, in a unit test with no network · the marketing build stays fully static (`next build` shows no route flipping to dynamic) · the currency switcher persists across a reload · no IP value appears in any log or DB row.

### L2 — i18n runtime and routing (3 days)
**Build:** `[lang]` route restructure · the second root layout for `(app)` · `proxy.ts` locale rewrite/redirect table · `getDictionary` · `Locale` type · `generateStaticParams` × 4 · language switcher.
**Dep:** L1 (shared proxy).
**Accept:** `/learn/sql` and `/de/learn/sql` both render statically · `/en/learn/sql` 301s to `/learn/sql` · a cookie-less request is never redirected · `curl` confirms `<html lang="de">` and metadata still ahead of body content (§13.1's known trap, re-checked because the layout moved).

### L3 — String extraction and three translations (5 days + review turnaround)
**Build:** extract every user-facing string in `src/app` and `src/components` into `en.json` · `Dictionary` type derived from it · `de` / `bg` / `es` drafts · email templates per locale · signup writes `user.locale`.
**Dep:** L2.
**Accept:** a missing key in any locale **fails typecheck** · a test asserts no JSX text node in `src/` is a bare English literal · every transactional email renders in all four locales in a snapshot test · `pnpm verify` clean with coverage still at 100%.

### L4 — AI output locale (3 days)
**Build:** locale threaded into the goal interview, lesson generator, tutor, evaluator and reflection prompts, inside the cached prefix · translated rubric display strings · `scripts/locale-token-probe.ts`.
**Dep:** L3.
**Accept:** **the evidence-quote substring test passes for a German, a Bulgarian and a Spanish artefact** (§8.3) · `cache_read_input_tokens > 0` still asserted, per locale · measured token multipliers recorded in `IMPLEMENTATION.md` and §8.5's estimates replaced with them.

### L5 — Locale-scoped item banks (2 days + per-pack content)
**Build:** `locale` and `calibrated` on `AssessmentItem` · per-locale YAML (`packs/sql-data-analysis/items.bg.yaml`) · loader and validator updates · locale filter in item selection.
**Dep:** L4.
**Accept:** `pnpm packs:validate` fails a locale file with a missing translation or a changed answer key · an uncalibrated item is never the sole basis for a placement · the Bulgarian SQL check runs end to end.

### L6 — SEO surface (3 days + content)
**Build:** `canonicalFor` / `alternatesFor` · `generateMetadata` alternates on every marketing route · sitemap per locale with `alternates.languages` · locale-aware `robots.ts` · the 20 Bulgarian pages (15 translated + 5 native).
**Dep:** L2.
**Accept:** hreflang reciprocity asserted in a test across all four locales including `x-default` · sitemap contains **only** `indexable: true` rows · Rich Results Test passes on one page per locale · German and Spanish pages exist and are `noindex`.

### L7 — Billing in two currencies (folded into E13, +1 day)
**Build:** MoR price sets in USD and EUR · VAT-inclusive display for EU · currency locked on the subscription row · FAQ line about currency immutability.
**Accept:** a full test-mode signup → cancel cycle in **both** currencies · the price shown on the pricing page byte-matches the checkout amount in an integration test · a German test purchase shows VAT-inclusive pricing and the MoR remits correctly.

**Total: ~18 engineering days plus ~€1,300 of translation review.** If time is short, cut **L5 and L6b/L6c** — locale-scoped item banks and the German/Spanish SEO surface. Never cut L1 (revenue) or the §8.3 quote test (correctness).

---

## 13. Tests

`AGENTS.md` is not negotiable here: 100% of `src/` on lines, functions, branches and statements, tests in the same change as the feature, no new `coverage.exclude` entries, `pnpm verify` clean before every commit. Localization is unusually easy to test because almost all of it is pure functions over strings.

| Area | Test |
|---|---|
| Locale negotiation | `Accept-Language` strings → expected locale, including `de-AT`, `es-419`, `bg`, malformed headers, and an empty header |
| Precedence | The full §5.1 table as a fixture matrix — URL beats cookie beats header beats geo beats default |
| Proxy routing | Every row of the §4.3 table: pass-through, 301, rewrite, and **cookie-less ⇒ no redirect** |
| Geo | Header present / absent / malformed; the dev override honoured only outside production |
| Currency | Country → currency for each EEA member, US, UK, and unknown; subscription currency wins over cookie |
| Price integrity | The pricing page's displayed amount equals the checkout amount, for both currencies |
| Dictionary completeness | Typecheck catches a missing key; a runtime test catches a value identical to English outside an allowlist |
| No hardcoded strings | Scan `src/**/*.tsx` for literal text nodes outside the dictionary |
| Formatting | `Intl` output pinned per locale — number grouping, date order, currency symbol placement (€ trails in German, leads in English) |
| **Evidence quotes** | **Every quote is a literal substring of the artefact, for `de`, `bg` and `es` submissions** (§8.3) |
| Prompt caching | `cache_read_input_tokens > 0` on the second tutor turn, per locale |
| hreflang | Reciprocity and `x-default` presence across all four locales |
| Sitemap | Locale entries carry alternates; non-indexable locales are absent |
| Visual regression | `/design` and every key screen in **`en` and `de`**, both themes — German is the width stress test |

---

## 14. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Three languages fragment a solo founder's effort** — `PLAN.md` risk #12, tripled | 🔴 Critical | The §0 split: currency ships early and costs nothing ongoing; UI ships once; **SEO content is gated per locale on evidence** (§15). Bulgarian first because it is free to produce |
| 2 | **Evaluation quality is unknown outside English** | 🔴 Critical | κ measured **per locale** on a per-locale golden set. If a locale lands below 0.6, its evaluations ship with a visibly lower confidence band, or that locale runs English-only submissions — and says so. §7.2's honesty rule already covers this |
| 3 | **Evidence-quote translation silently breaks evaluations** | 🟠 High | §8.3's test, in CI, before any locale goes live |
| 4 | **Machine-translated pages get treated as scaled content** | 🟠 High | `noindex` by default (already the schema default) · native review before indexing · locale-native pages carry the Bulgarian cluster · the same 50-page discipline from §12.1 |
| 5 | **Bulgarian AI cost is 2× and nobody notices** | 🟡 Medium | `locale` on `interaction` / `agentRun` · the token probe · locale-aware spend cap if the multiplier exceeds 2× |
| 6 | **Cyrillic typography looks broken or Russian** | 🟡 Medium | §9.1 — font selection gated on Cyrillic coverage *and* Bulgarian `locl`; Bulgarian screenshots in the visual suite |
| 7 | **Geo-redirect kills English indexation** | 🟠 High | No cookie-less redirect, ever. Crawler-safe by construction, verified by the §13 proxy test |
| 8 | **€25 is the wrong price for Bulgaria and LatAm** | 🟡 Medium | Per-country conversion instrumentation from day one; regional price sets only on evidence (§6.6) |
| 9 | **The `[lang]` refactor destabilises a working marketing build** | 🟡 Medium | §4.2's fallback shape needs no root-layout split. Re-run the §13.1 `curl` metadata check after the move — the trap it names is exactly the kind that reappears when layouts change |
| 10 | **Every future feature now costs 4× the copy** | 🟡 Medium | Accepted, and cheap if enforced mechanically: the typed dictionary means an untranslated feature cannot compile, so the cost is paid at authoring time rather than discovered by a user |

---

## 15. Decide-or-drop criteria, per locale

Measured 90 days after that locale's pages go indexable, in the spirit of `PLAN.md` §17.3 — pre-committed, not argued about later.

| Signal | Drop the locale | Hold | Invest further |
|---|---|---|---|
| Organic impressions (GSC, that locale) | <200/mo | 200–2,000 | >2,000 |
| Signups attributed to that locale | <5 | 5–25 | >25 |
| Paid conversion vs. the English rate | <40% | 40–80% | >80% |
| Evaluation κ on that locale's golden set | <0.5 → **English-only submissions in that locale** | 0.5–0.6 | ≥0.6 |

**Dropping a locale means:** its pages go `noindex` and its `hreflang` entries are removed; the **product UI translation stays**, because it is already paid for and costs nothing to keep. Language support and content investment are separate commitments, and only the second one is expensive.

---

## 16. Verification

| Component | How to confirm it works |
|---|---|
| Static rendering survives | `next build` — every `/[lang]/…` route still marked static; no route flipped to dynamic by a stray `headers()` call |
| Metadata position | `curl -s https://…/de/learn/sql \| head -100` — metadata in `<head>` ahead of body content, re-checked after the layout split (§13.1's known trap) |
| hreflang | Fetch one page per locale; assert the cluster is complete, reciprocal and includes `x-default`. Automated test, not a spot check |
| No geo-redirect for crawlers | `curl` with no cookies from any country header — assert 200 with English content, never a 30x |
| Redirect hygiene | `curl -I /en/learn/sql` → 301 to `/learn/sql`; assert no chain |
| Price integrity | Integration test: pricing page amount == checkout session amount, for USD and EUR |
| VAT | One live test purchase per EU country in MoR test mode; confirm inclusive display and correct remittance |
| Evidence quotes | The §8.3 substring test, per locale, in CI |
| Token cost | `pnpm tsx scripts/locale-token-probe.ts` — real API, real counts, recorded in `IMPLEMENTATION.md` |
| Typography | Visual regression in `en` + `de`, both themes; one Bulgarian screenshot reviewed by eye for Cyrillic letterforms |
| Coverage | `DATABASE_URL=… pnpm verify` clean — 100%, no new exclusions |

---

## Open questions

Four, and only the first two block work:

1. **Does the founder want German and Spanish SEO content at all before revenue?** This plan assumes no — UI in three languages, indexable content in Bulgarian only until the §15 criteria justify paying for native review. If the answer is yes, add ~€800 and two weeks.
2. **Which MoR — Polar or Paddle?** `PLAN.md` §18.1 left it open. Both do EUR/USD price sets and EU VAT; Paddle's regional pricing is more mature, Polar's fees are lower. §6.6's deferred regional pricing makes this reversible, so pick the cheaper one now.
3. **Neutral Spanish, or commit to Spain?** This plan says neutral. If Spain is the actual target market, `es-ES` with Iberian vocabulary will convert better there and read as foreign in Latin America.
4. **Is Bulgarian's dual BGN/EUR display obligation still in force?** §6.4 — five minutes to check, and it changes the pricing page.
