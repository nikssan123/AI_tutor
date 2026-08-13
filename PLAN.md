# Adaptive Learning Platform — Startup & Engineering Plan

## Context

You want to build a horizontal SaaS that takes a learning goal, assesses current ability, builds a personalized adaptive curriculum, teaches, sets practice, evaluates real work, tracks mastery, and decides what to do next — for **any** skill, technical or not. SEO must be a first-class part of the product, not an afterthought.

I researched the competitive landscape before planning. **Two findings should reshape the concept, and this plan is built around them:**

1. **The "AI generates you a personalized curriculum" product already exists, multiple times, and is being given away.** [roadmap.sh](https://roadmap.sh/premium) sells unlimited AI-generated courses, roadmaps, quizzes, learning plans and AI tutor chat for **$10/month**, sitting on [~470K monthly organic visits](https://hackmamba.io/case-study/how-roadmap-grew-organic-traffic-by-138-percentage-in-24-months/) and top-5 rankings for the exact head terms in your brief. [Ulern.com](https://ulern.com/) is a near-verbatim implementation of your concept at €27/month. [Oboe](https://techcrunch.com/2025/09/10/after-selling-to-spotify-anchors-co-founders-are-back-with-oboe-an-ai-powered-app-for-learning/) raised $16M from a16z for it. ChatGPT Study Mode, Gemini Guided Learning and Claude Learning Mode do the tutoring layer free.
2. **The generation step is not where the value or the retention is.** AI apps churn ~30% faster than non-AI apps ([21.1% vs 30.7% annual retention](https://www.technewsworld.com/story/ai-apps-generate-revenue-but-struggle-with-retention-180236.html)), and a diligence review of four AI-tutor startups found [three of four were thin LLM wrappers with no mastery model and sub-12% day-30 retention](https://www.forasoft.com/blog/article/ai-tutors-adaptive-learning-2026).

**Decisions you made, which this plan honours:** horizontal across all domains (technical skilled/unskilled and non-technical); build the full MVP first and validate after; English-first with one local-language beachhead.

Because you chose "build first, validate after," I have not reduced MVP scope — instead the plan bakes validation instrumentation and explicit kill-criteria into the MVP itself, so the evidence arrives automatically in week 5 rather than requiring a separate phase.

---

# 0. Where the build is

**This plan describes the product; it is not a status report.** Sections written
before something was built still read as future tense, and a few of them turned
out to be wrong in ways only building revealed. Those carry a **"Built."** note
inline — §7.1 and §8 screen 3 have the substantial ones.

For what exists right now, and what to pick up next, go straight to
**§24's build status table**. The short version: the engine, the intake
conversation, the diagnostic, the curriculum, the session and tutor, and
on-demand pack generation are all in, and so is **E8 — submission and evaluation,
the one the whole thesis rests on** (§4.2 law 1, §14.5). E8's code is complete
and the loop has been run end to end; what remains is the hand-graded corpus its
acceptance criteria need. **E9 is the next epic to build.**

`IMPLEMENTATION.md` is the per-pass record, including the things that only
showed up against the real API. Read the "Still open" section at the end of the
last pass before starting anything.

---

# 1. Executive Verdict

## **BUILD — WITH A MAJOR PIVOT OF THE VALUE PROPOSITION**

The market is real and the workflow you described is right. But **"generate a personalized curriculum" is already commoditized and free**, and building on it means competing on the one axis where you have no advantage. The pivot is one sentence:

> **Stop selling the plan. Sell the verdict on the learner's actual work.**

Everything else in your brief survives intact — goal decomposition, skill graph, adaptive path, daily sessions, mastery model. The change is which part is *the product* and which part is *plumbing*. Curriculum generation becomes a cheap commodity input. **The rubric-graded evaluation of real submitted artefacts, and the longitudinal mastery ledger built from those verdicts, becomes the product.**

| | |
|---|---|
| **Strongest opportunity** | Nobody credibly answers *"can I actually do this yet?"* Every competitor generates plans and scores multiple-choice quizzes. Almost none ingests your real code, essay, spreadsheet, photograph, recording or design and returns a calibrated, rubric-anchored, longitudinal verdict. That is the thing people pay for and come back to. |
| **Biggest risk** | Retention, not acquisition. The "wow" of a generated plan is a novelty cliff. If a user's week-3 session feels like ChatGPT with a progress bar, they churn inside the first billing cycle. Second-biggest: going horizontal on day one means every domain is shallow unless the architecture forces depth. |
| **Initial niche** | You chose horizontal. The plan delivers it via **Domain Packs** (§7) with **five explicit evaluation-capability tiers** (§7.2) — the platform serves every domain from launch, but declares honestly what it can verify per skill, and concentrates depth investment on the 12 packs that drive revenue. |
| **Recommended MVP** | The full loop for a single active goal: goal interview → adaptive diagnostic → skill graph → planned path → daily session → **artefact submission → rubric evaluation → mastery update** → next best action. Plus the free public Skill Check + Roadmap tool and 50 SEO pages. §17. |
| **Key competitive advantage** | The **Mastery Ledger**: an evidence-backed, per-skill record of what you have demonstrably done, with the artefacts attached. Copyable in concept; not copyable in *calibration*, which is the accumulating asset (§21). |
| **SEO opportunity** | **Not** "how to learn X" — those SERPs are owned by DA85+ sites. The winnable surface is **interactive skill assessments** (`/check/*`), **graded project briefs with public rubrics** (`/projects/*`), and **"X for people who already know Y"** long-tail. These are tools and unique data, not articles — they escape Google's scaled-content-abuse exposure by construction. |
| **Primary channel** | SEO long-tail + free tools as the compounding engine (12–18 month payoff), with communities and shareable Proof Pages carrying months 0–9. Paid ads: no, beyond a €300 keyword-validation test. |

---

# 2. Market Research

## 2.1 Is the market saturated?

**The "AI course generator" layer: yes, brutally. The "verified skill" layer: no.**

| Layer | Saturation | Evidence |
|---|---|---|
| Chat tutoring | **Commoditized to zero** | ChatGPT Study Mode, Gemini Guided Learning, Claude Learning Mode — all free/bundled, all Socratic, all better-funded |
| Curriculum/roadmap generation | **Commoditized to ~$10/mo** | roadmap.sh Pro: unlimited AI courses/roadmaps/quizzes/plans, $10/mo |
| Generated micro-courses | **Well-funded, crowded** | Oboe ($16M a16z), Ulern, AdaptLearn, dozens of Product Hunt entrants |
| Content libraries | **Saturated, declining** | Coursera, Udemy — AI is eating this from below |
| Practice with execution | **Healthy, proven, uncrowded** | boot.dev: $59/mo, 1.2M students, [seven-figure monthly revenue, bootstrapped](https://www.indiehackers.com/post/creators/hitting-10m-arr-with-rpg-style-programming-courses-b1JEom0xSuVU4EIvPfdf) |
| **Cross-domain evaluated proof-of-skill** | **Essentially empty** | No general-purpose product ingests arbitrary work artefacts and maintains a calibrated mastery model across domains |

## 2.2 Is "AI-generated personalized curriculum" commoditized?

Yes. Unambiguously. A competent developer can build a passable version in a weekend with one Claude call. The marginal cost is cents. Three of the largest AI companies give it away. **Any plan whose core value is "we generate a good plan" is dead on arrival.** This is the single most important research finding and it is why the pivot is non-negotiable.

## 2.3 What unmet need actually remains?

Five, in descending order of strength:

1. **Verification.** "Am I actually any good at this yet?" Self-assessment is famously unreliable. No AI product answers this credibly across domains.
2. **Evidence-anchored progress.** Not "63% complete" but "here are the four artefacts you produced, and here is what they prove you can do." This is what people show employers, clients and themselves.
3. **Continuity across sessions.** ChatGPT forgets your trajectory. A persistent, structured learner model that survives months is genuinely hard to replicate in a chat window.
4. **Accountability.** The gap between intending to learn and learning is the entire market. A system that knows what you owe it, and notices when you don't deliver, is worth more than a system that explains well.
5. **Honest scope.** A system that says *"I can rigorously grade your SQL; I can give you useful structured feedback on your photograph but I am not a professional critic; I cannot verify that you can hold a conversation until you record one"* — that honesty is itself differentiation in a category built on overclaiming.

## 2.4 Why choose this over ChatGPT?

This is the question that kills most AI SaaS. Five honest answers, ranked by durability:

| Reason | Durable? | Why |
|---|---|---|
| **It remembers and models you across months** | ✅ Strong | A structured per-skill mastery state, updated from evidence, with decay. ChatGPT memory is unstructured recall, not a model. |
| **It grades your work against a fixed, published rubric** | ✅ Strong | ChatGPT is sycophantic and inconsistent run-to-run. A published rubric + multi-pass verification + calibration is a different product. |
| **It decides what's next; you don't have to** | ✅ Strong | The cognitive load of self-directing is why people fail. ChatGPT never says "do this today." |
| **It holds you accountable** | ✅ Strong | Scheduled commitments, streaks, overdue work, spaced retrieval. ChatGPT is passive. |
| **Better explanations** | ❌ None | Same underlying models. Never compete here. |

The one-line positioning: **"ChatGPT can teach you anything. It can't tell you whether you've learned it."**

## 2.5 What could become a data/learning moat?

Detailed in §21. Short version: the item bank + rubric library with **calibration data** — which assessment items actually discriminate skill level, which rubric criteria actually predict downstream success, which curriculum orderings actually produce faster mastery for which learner profiles. That improves monotonically with volume, cannot be scraped, and is the only asset here that compounds.

## 2.6 Search demand: what I verified, and what you must verify in week 1

**Verified by SERP inspection (facts):**
- "How to learn Python" is dominated by DataCamp, Dataquest, Mimo, Coursera, Real Python — DA 80–90 domains with years of topical authority. **A new domain will not rank here inside 18 months.**
- "AI engineer roadmap" is owned by roadmap.sh, Scaler, DataCamp, Dataquest, Turing College, plus Medium/GitHub. Same conclusion.
- The **skill-assessment** SERP ("python skill test", "test your python level") is comparatively thin: Real Python quizzes, Dataquest, TestDome, CodeChef, Sanfoundry. No dominant modern interactive tool. **This is the crack in the wall.**

**Not verified — treat as unknown, not as estimates.** I could not obtain reliable per-keyword volume or difficulty. Third-party numbers are modelled estimates and I will not launder them into this plan as facts.

**Week-1 verification protocol (do this before writing the SEO content):**
1. Google Keyword Planner (free with any Ads account, even unspent) — pull volume for the full seed list in §10. Ranges only; that's fine.
2. Google Trends — relative trajectory over 5 years for each cluster; kill anything declining.
3. Ahrefs free Keyword Difficulty checker + free Website Authority checker on the top 3 ranking URLs per term. **Rule: if all three top results have DR > 60, deprioritise the term for 12 months.**
4. Manually inspect 20 SERPs. Record: does the SERP reward an *article*, a *tool*, or a *forum thread*? Only target terms where the SERP rewards a tool or where a tool would visibly out-serve the intent.
5. Bing Webmaster Tools keyword research (free, no card) as a cross-check.

---

# 3. Competitive Analysis

Verified facts are cited. Anything unlabelled is my assessment from direct product inspection.

| Competitor | Core proposition | Onboarding | Curriculum gen | Assessment | Evaluates real work | Mastery model | Pricing | SEO position | The gap you exploit |
|---|---|---|---|---|---|---|---|---|---|
| **roadmap.sh** | Community dev roadmaps + AI tutor | Pick a roadmap, or prompt the AI | AI courses/roadmaps/plans, unlimited | Quizzes | **No** | Manual checkboxes | Free / **$10/mo Pro** / $10 seat Team | **Dominant.** ~470K organic/mo, top-5 for "frontend development" (~58K/mo) | Zero evaluation of real work. Progress is self-declared. Dev-only. |
| **Ulern** | "Personal AI tutor, plan built around you, adapts as you go" | Goal → plan in 3 steps | Yes, researched + structured | Infers from response completeness | **No** | Implicit, response-quality based | €27/mo, €89/mo Pro, 7-day trial | Negligible — no visible organic footprint or reviews found | **Your exact idea, already live.** But: no artefact evaluation, no evidence trail, no public/SEO surface. Beat it on proof, not on plans. |
| **Oboe** | "Chat that actually teaches you. Structured, cited, personalized" | Prompt a topic | Excellent, fast, multi-format (text/audio/games) | Interactive tests | **No** | [None — no diagnostic, no spaced review, no mastery checks](https://tomdaccordai.substack.com/p/obeo-fresh-bite-size-ai-pathways) | Free tier (5 courses) + 2 paid tiers | Building; a16z-funded, $16M | Beautiful, shallow, one-shot. Consumption product, not achievement product. |
| **ChatGPT (Study Mode)** | Socratic tutor inside a general assistant | None | On request, ephemeral | Conversational | Partially — will review pasted work, inconsistently | **No** | $20/mo bundled | Not applicable (it's the destination) | No persistence, no structure, no accountability, no verdict you can trust twice. |
| **Claude (Learning Mode)** | Most "teacher-like" feedback | None | On request | Conversational | Partially | **No** | Bundled | N/A | Same as above. |
| **Gemini (Guided Learning)** | Structured staged tutor with visuals | None | Staged breakdown | Explain-your-thinking prompts | Partially | **No** | Free with Google account | N/A | Free and good. Never compete on tutoring quality. |
| **boot.dev** | Gamified backend dev, real code execution | Pick a path | Fixed, human-authored | Coded exercises | ✅ **Yes — code runs** | Course completion | **$59/mo, $399/yr** | Strong content marketing | **The proof that WTP is high when work is verified.** But: one domain, fixed curriculum, no personalization. |
| **Duolingo** | Gamified language | Placement test | Fixed tree | Adaptive drills | Partially (speech) | Yes, per-skill | Free / Super / [Max $29.99/mo](https://copycatcafe.com/blog/duolingo-max) | Enormous | Single domain. Proves gamified retention + $30/mo WTP. |
| **Khan Academy / Khanmigo** | K-12 mastery learning + AI tutor | Course/grade | Fixed, expert-built | Mastery-based | Partially | ✅ **Yes, genuinely** | [$4/mo](https://www.myengineeringbuddy.com/blog/khanmigo-reviews-alternatives-pricing-offerings/) | Enormous | K-12 academic only. Not for adults with career goals. Price-anchors the market low for academics. |
| **AdaptLearn** | Adaptive paths + AI tutor (2 distinct products: India exam-prep, and a generic path builder) | Form | Yes | Yes | **No** | Analytics dashboards | Varies | Weak | Exam-prep vertical or generic; no artefact grading. |
| **Coursera / Udemy** | Content libraries | Catalog browse | None (human courses) | Quizzes, peer review | Peer only | Completion | Per-course / $59/mo | Enormous | Static, slow, not personalized. Being disrupted from below. |
| **OpenUni.AI / LearningPath.ai / various** | Course-material Q&A, curated AI paths | Varies | Varies | Minimal | **No** | No | Free / varies | Minimal | Small, unfocused. |

## 3.1 Which are genuinely differentiated, and which are LLM wrappers?

**Genuinely differentiated:** boot.dev (real code execution + gamification system), Duolingo (data-driven adaptive engine at scale + brand), Khan Academy (decades of expert-authored mastery-based curriculum).

**Substantially LLM wrappers:** Ulern, Oboe (beautiful, well-engineered wrapper — the craft is real, the defensibility is not), AdaptLearn (generic variant), and essentially every recent entrant. This matches the [diligence finding that three of four AI-tutor startups had no mastery model and sub-12% day-30 retention](https://www.forasoft.com/blog/article/ai-tutors-adaptive-learning-2026).

**The lesson:** the wrapper layer is where everyone is. The evaluation + mastery layer is where boot.dev, Duolingo and Khan built durable businesses — and none of them do it horizontally.

## 3.2 SEO competitive reality

| Site | Authority indicator | Strategy | Beatable? |
|---|---|---|---|
| roadmap.sh | 6th most-starred repo on GitHub; ~470K organic/mo; grew [197K → 470K in 24 months](https://hackmamba.io/case-study/how-roadmap-grew-organic-traffic-by-138-percentage-in-24-months/) | Free open-source roadmaps → massive backlinks → topical authority → monetize with AI Pro | **No, not head-on.** Do not build `/roadmaps/frontend-developer`. |
| DataCamp / Dataquest / Coursera | DA 80–91 | Massive evergreen guide libraries, decade of links | **No** on head terms |
| Real Python / freeCodeCamp | DA 80+, enormous backlink profiles | Deep tutorials, community | **No** on head terms |
| TestDome / CodeChef skill tests | Moderate | Assessment pages | **Yes** — these are dated, non-adaptive, and thin |

**Conclusion:** the head-term war is lost before it starts. The plan in §9–10 does not fight it.

---

# 4. Product Thesis

## 4.1 Your thesis, evaluated

> *"Don't generate courses. Manage learning journeys."*

**Half right, and the half that's wrong matters.** "Managing a journey" is exactly what roadmap.sh Pro and Ulern already claim, at $10 and €27. Journey management is a *feature*, not a moat, because the artefacts of journey management (plan, next action, progress bar) are all generatable text.

The sharpened thesis:

> ### Don't manage journeys. Verify capability.
>
> **User → goal → diagnostic → skill graph → mission → learn → *produce something real* → *graded against a published rubric* → mastery ledger updated with evidence → next best action.**

The load-bearing word is **produce**. Every loop iteration must end in an artefact the system can inspect: code, a query, a written argument, a spreadsheet, a photograph, a recording, a design, a plan, a solved problem set, a transcribed conversation. Passive lessons and multiple-choice do not update mastery beyond a low ceiling.

## 4.2 The five product laws

These are constraints, not aspirations. Each one is a decision the competitors did not make.

1. **No mastery without evidence.** A skill's mastery score can only rise from a graded observation on learner-produced work. Reading, watching, and "marking complete" move a *coverage* counter, never mastery. This single rule is the product.
2. **Every rubric is public before the work is done.** The learner sees exactly what they're being judged on. This makes evaluation trustworthy, makes disagreement productive, and makes the rubric a linkable SEO asset (§10).
3. **Confidence is always shown.** Every verdict carries a confidence band and the evidence tier it came from. The system says "I'm 60% sure" when it's 60% sure. Overclaiming is the fastest way to lose an expert user.
4. **The system owes the learner a next action, every day, unprompted.** If the learner has to decide, we've failed.
5. **Declared limits per domain.** Each skill declares what the platform can and cannot verify. Honest scope is a feature.

## 4.3 Is this actually differentiated?

Test it against the field: roadmap.sh — no. Ulern — no. Oboe — no. ChatGPT/Claude/Gemini — no (no persistence, no published rubric, no ledger). boot.dev — yes, but only for backend code. Duolingo — yes, but only for languages. Khan — yes, but only K-12.

**Nobody does evidence-based, rubric-anchored, cross-domain mastery verification.** That is a real gap, and it is the one gap in this space that isn't a weekend of prompt engineering.

---

# 5. Target User

You chose horizontal. That is a market-coverage decision, not a marketing decision — **you still need one person to write copy for.** Serve everyone; speak to one.

**Primary persona — "The Serious Self-Directed Adult" (write all copy for this person):**

- 25–45, employed, income to spend, learning outside formal education
- Has a **goal with an outcome attached** — a job change, a promotion, a client, a portfolio, an exam, a trip, a performance
- Has tried and stalled: bought courses, watched YouTube, asked ChatGPT, has nothing to show
- Explicit pain: *"I don't know if I'm actually getting better"* and *"I don't know what to do next"*
- 3–8 hours/week, irregular
- Will pay $20–40/mo for progress they can see; will not pay for content

**Anti-persona — actively design against:** the casual browser who wants to "learn about" something. They are Oboe's user. They churn in 3 weeks, cost you AI spend, and distort your metrics. Do not optimise onboarding for them.

**Segment coverage under the horizontal mandate** (all live at launch, different depth — see §7 Domain Packs):

| Cluster | Examples | Eval tier | WTP | Priority |
|---|---|---|---|---|
| Technical / skilled | ML, backend, cloud, security, data eng | 1 | Very high | **Depth pack** |
| Technical / entry | Python basics, SQL, web dev, Excel | 1 | High | **Depth pack** |
| Professional & business | Marketing, finance, PM, negotiation, analytics | 2 | High | **Depth pack** |
| Academic | Maths, statistics, physics, exam prep | 1–2 | Medium | Depth pack |
| Languages | Spanish, German, English | 4 | Medium-high | Standard (voice = phase 2) |
| Creative | Photography, music, writing, design | 3 | Medium | Standard |
| Practical / lifestyle | Cooking, fitness, chess, DIY | 3 | Low-medium | Generated pack |
| Communication | Public speaking, interviewing, sales | 4 | High | Standard (voice = phase 2) |

---

# 6. Positioning

## 6.1 Positioning matrix

Scored 0–5. **Bold** = the axes you win on.

| | Personal-isation | Goal-oriented | Adaptive curric. | AI tutoring | Real projects | **Evaluates work** | **Mastery tracking** | Breadth | SEO presence | Price/mo | Learning effect. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **This product** | 5 | 5 | 5 | 4 | 5 | **5** | **5** | 5 | 0→3 | $25 | 5 (target) |
| ChatGPT / Claude | 3 | 2 | 1 | 5 | 2 | 2 | 0 | 5 | n/a | $20 | 3 |
| Gemini Guided | 3 | 2 | 2 | 5 | 2 | 2 | 0 | 5 | n/a | $0 | 3 |
| roadmap.sh Pro | 3 | 4 | 3 | 4 | 3 | 0 | 1 | 2 | **5** | $10 | 3 |
| Ulern | 4 | 4 | 4 | 4 | 2 | 1 | 2 | 5 | 0 | €27 | 3 |
| Oboe | 3 | 2 | 2 | 4 | 1 | 0 | 0 | 5 | 1 | ~$15 | 2 |
| boot.dev | 1 | 4 | 1 | 3 | 5 | **5** | 3 | 1 | 3 | $59 | 5 |
| Duolingo | 3 | 3 | 4 | 3 | 2 | 3 | **5** | 1 | 5 | $30 | 4 |
| Khan / Khanmigo | 3 | 3 | 4 | 4 | 2 | 2 | **5** | 2 | 5 | $4 | 4 |
| Coursera / Udemy | 1 | 2 | 0 | 1 | 3 | 1 | 1 | 5 | 5 | $59 | 2 |

**The two empty columns for every horizontal competitor are "Evaluates work" and "Mastery tracking." That is the entire strategy.**

## 6.2 Positioning statement

> **For self-directed adults who are tired of not knowing whether they're actually improving,
> [Product] is an AI coach that grades the real work you produce and keeps an evidence-backed record of what you can genuinely do —
> unlike AI chatbots and course generators, which give you plans and explanations but never a verdict.**

**Homepage headline:** *"Don't just learn it. Prove it."*
**Subhead:** *"Tell it your goal. It finds your gaps, sets you real work, grades what you make, and shows you exactly what you can do — and what's left."*

---

# 7. Serving Every Domain Without Being Shallow Everywhere

This section exists because you chose horizontal. Without it, "everything" means "mediocre at everything" — the exact failure mode that kills this category.

## 7.1 Domain Packs

A **Domain Pack** is a versioned data bundle, not code. The engine is domain-agnostic; packs supply domain knowledge.

```
DomainPack {
  slug, name, taxonomy_parent
  skill_graph_seed:   Skill[] + SkillDependency[]     # canonical, curated or generated
  item_bank:          AssessmentItem[]                # diagnostic + retrieval items
  rubric_library:     Rubric[]                        # per skill/artefact type
  evidence_types:     EvidenceType[]                  # what a learner can submit
  workspace:          WorkspaceId                     # which work surface to render — see 7.3
  eval_tier:          1..5                            # see 7.2
  evaluator_config:   { model, passes, verifier, tools }
  resource_index:     Resource[]                      # vetted external references
  session_templates:  SessionTemplate[]               # activity shapes
  quality:            { status, reviewed_by, reviewed_at, score }
}
```

**Three pack maturity levels — visible in the product:**

| Level | How built | Count at launch | Badge shown to user |
|---|---|---|---|
| **Curated** | Hand-authored skill graph + rubrics, human-reviewed, calibrated against real submissions | **12** | "Deeply supported" |
| **Standard** | AI-generated from authoritative sources, validated by the Curriculum Validator (§14.6), spot-checked by you | **~60** | "Well supported" |
| **Generated** | Created on demand when a user requests an uncovered goal; queued for validation; promoted to Standard after 5 users + quality gate | unbounded | "Experimental — help us improve it" |

This is how you honestly serve "any skill" on day one. Any goal works. Coverage is universal. Depth is declared, not faked.

> **Built.** See §24 E7.5. What building it changed about this section:
>
> - **A Generated pack is capped below tier 1**, whatever its workspace. Tier 1
>   means "execute + assert" (§7.2) and a pack with no evaluator config cannot.
>   Curated packs in the same workspace still reach tier 1; the difference is a
>   person built the evaluator.
> - **A Generated pack is not "queued for validation"** — it is validated before
>   it is written, and one that cannot clear the bar is never created. The
>   learner is told so. There is no half-pack state.
> - **The promotion rule needed a second condition.** "Promoted to Standard after
>   5 users" is necessary but not sufficient; it must also still pass validation
>   at the moment of promotion, since packs can be edited and edges can be added.
>   Both are enforced in `promotePack`, not in the admin UI.
> - **Packs are shared, keyed by slug.** Ten people asking for Rust cause one
>   generation. This is what makes "after 5 users" meaningful and what keeps the
>   economics sane at $0.61 a pack.

**The 12 Curated packs at launch** — chosen for WTP × evaluability × search demand:
Python & programming fundamentals · SQL & data analysis · Machine learning / AI engineering · Web development (JS/React) · Cloud & DevOps · Cybersecurity · Excel & spreadsheet modelling · Digital marketing & SEO · Personal finance & investing · Business writing & communication · Statistics & data literacy · Product management

## 7.2 Evaluation-capability tiers — the honesty mechanism

Every skill carries a tier. The tier determines what evidence counts, how confident the verdict is, and what the UI is allowed to claim.

| Tier | Name | Domains | Evidence | Method | Confidence | Claim the UI may make |
|---|---|---|---|---|---|---|
| **1** | Machine-verifiable | Code, SQL, maths, statistics, spreadsheets, data | Repo, script, query, workbook, numeric answer | Execute + assert against expected behaviour; **then** LLM rubric review for quality | **High (0.85–0.95)** | *"Verified: this works."* |
| **2** | Artefact review | Writing, marketing, finance models, PM docs, business plans, design specs, slides | Document, deck, model, plan, copy | Multi-pass LLM rubric grading + self-consistency + verifier pass | **Medium-high (0.65–0.85)** | *"Assessed against the rubric."* |
| **3** | Media review | Photography, music, cooking, video, visual art, DIY | Image, audio, video, photo of result | Multimodal rubric grading against technical criteria only; aesthetics flagged as subjective | **Medium (0.5–0.7)** | *"Technical feedback. Aesthetic judgement is yours."* |
| **4** | Performance | Languages, public speaking, interviewing, sales, negotiation | Recording, live voice roleplay, transcript | Transcription + rubric on structure/fluency/accuracy; roleplay simulation scoring | **Medium (0.5–0.75)** | *"Scored on measurable dimensions."* |
| **5** | Unverifiable | Motivation, taste, confidence, "understanding" without output | Self-report only | None | **None** | *"Self-reported. Not counted as mastery."* |

**Hard rule: a Tier 5 observation can never raise a mastery score.** It is logged as engagement, nothing more. This rule is what stops the horizontal product from becoming a plausible-sounding lie.

**Confidence propagates to the UI everywhere.** A Tier 3 skill at 0.8 mastery renders as "Likely capable — based on 3 reviewed images" not "80% mastered."

## 7.3 Domain workspaces — how one product serves every subject

### We do not build a site per learner or per goal

**One application, one design system, one navigation model.** No per-user microsites, no generated per-goal sites, no white-labelled spaces. Two reasons: a bespoke surface per goal is unmaintainable at the breadth you've chosen, and auto-generated per-user pages are exactly the scaled-content pattern §12 exists to avoid.

The only public per-learner surface is the **Proof Page** — a single template populated with that learner's real evidence, `noindex` until it passes the §12 quality gate.

### What *does* vary: the workspace

A photography learner and a Python learner cannot share a submission panel. So the **middle of the screen** is domain-adaptive while everything around it is not:

```
┌──────────────────────────────────────────────┐
│  Same nav, same header, same design tokens   │  ← never changes
├──────────────────────────────────────────────┤
│                                              │
│           WORKSPACE (swappable)              │  ← the only variable part
│                                              │
├──────────────────────────────────────────────┤
│  Same tutor panel, same submit affordance    │  ← never changes
└──────────────────────────────────────────────┘
```

**Six workspaces cover every domain in §5.** Each is an input affordance + a preview/viewer + a submission adapter — nothing more.

| Workspace | Learner submits | Preview | Domains | Eval tier | MVP? |
|---|---|---|---|---|---|
| **Text** | Prose, plan, analysis, spec | Rendered markdown, word count | Writing, marketing, PM, business, academic, finance narrative | 2 | ✅ |
| **Code** | Repo URL, file upload, paste | Syntax-highlighted diff, test output | Programming, data eng, cloud, security | 1 | ✅ |
| **Query & Sheet** | SQL, spreadsheet/CSV | Result table, formula inspector | SQL, Excel, financial modelling, analytics | 1 | ✅ |
| **Media** | Image, video upload | Full-fidelity viewer on a fixed neutral mat (§8.5.4) | Photography, design, cooking, DIY, art | 3 | ✅ |
| **Audio** | Recording upload | Waveform, transcript | Music, language pronunciation, speaking | 3–4 | Phase 2 |
| **Conversation** | Live voice or text roleplay | Turn-by-turn transcript with scoring | Languages, sales, negotiation, interviewing | 4 | Phase 2 |

### The rules that keep this from exploding

1. **The workspace is chosen by data, not code.** `Skill.evidenceType` → `DomainPack.workspace` → component. Adding a new domain requires **no code change** — that is the whole point of Domain Packs (§7.1).
2. **All six emit the same thing.** A workspace's only contract is producing a `NormalizedArtifact` for the single evaluation pipeline in §14.9.1. The grader never knows which workspace produced the input.
3. **We do not build editors. Ever.** No in-browser IDE, no photo editor, no DAW, no spreadsheet app. Learners use the real tools they would use in real work — VS Code, Lightroom, Excel, a camera — and submit the result. **This is a deliberate scope wall.** Building creation tools is a different company, it destroys the 30-day timeline, and it would make the product worse: the point is proving you can do the real thing in the real environment.
4. **The tutor panel is identical everywhere.** Domain knowledge lives in the pack and the prompt, never in the chrome.
5. **MVP ships four.** Text, Code, Query & Sheet, Media — covering 10 of the 12 Curated packs and every Tier 1–3 domain. Audio and Conversation wait for voice in phase 2; until then those domains run in Standard mode with Text/Media submission and honestly lower confidence.

**Cost of this approach:** roughly 4–5 extra days in the MVP versus a single generic file-upload box. Worth it — the workspace is where the learner does the work the entire product exists to evaluate, and a generic upload field would make Tier 1 code grading and Tier 3 media review feel like the same shallow thing.

---

# 8. User Journey & Screens

Each screen: purpose, key UI, interactions, data required, AI behind it, SEO implications.

### 1. Landing page — `/`
- **Purpose:** convert cold traffic to a free Skill Check in <60 seconds. Nothing else.
- **UI:** headline + one input: *"What do you want to get good at?"* with autocomplete against the goal taxonomy. Below: 3-step visual (Check → Path → Prove). A real, anonymised Proof Page as social proof. Grid of popular goals (internal links to `/learn/*`).
- **Interaction:** typing a goal starts the AI clarification conversation immediately, no signup.
- **Data:** goal taxonomy for autocomplete; featured public Proof Pages.
- **AI:** Haiku 4.5 classifies free-text goal → taxonomy node, or flags "new goal" for pack generation.
- **SEO:** static, ISR, `WebApplication` + `Organization` JSON-LD. Hub for the whole internal link graph.

### 2. SEO learning page — `/learn/{topic}`, `/check/{skill}`, `/projects/{slug}`
- **Purpose:** rank, be genuinely useful without signup, convert to the free tool.
- **UI:** see §11 for the full page spec. Every page embeds a working interactive tool above the fold.
- **Data:** `SeoPage`, `LearningTopic`, `Skill`, `Rubric`, `Faq`, `Resource`, `InternalLink`.
- **AI:** none at request time (statically generated + cached). AI ran at build/authoring time behind the quality gate.
- **SEO:** the entire acquisition engine. §9–11.

### 3. Goal creation + AI clarification — `/start`
- **Purpose:** extract a complete goal spec in ≤6 exchanges. **Not a form.**
- **UI:** chat, one question at a time, with **smart chips** for common answers so most replies are one tap. Live-updating sidebar showing what's been captured: Goal / Level / Time / Deadline / Motivation / Constraints.
- **Interactions:** skip any question; edit any captured field; "I don't know" is always valid.
- **Data:** `LearningGoal`, `LearnerProfile`.
- **AI:** **Goal Analyzer** (Sonnet 5, structured output → `GoalSpec`). Asks only for fields it can't infer. Refuses to ask more than 6 questions — hard cap in application code, not prompt.
- **Note:** signup is deferred until *after* the diagnostic result. Show value first.
- **Built.** Two things this description got wrong in practice:
  - **Clarity must not end the conversation.** Ending as soon as clarity passes
    0.6 means the analyzer asks a question and the learner watches their plan
    appear without answering it. Clarity decides whether to keep *asking*; only
    the analyzer declaring itself done, or the turn cap, ends anything.
  - **The catalogue goes in the prompt.** The analyzer is handed the real slugs
    and asked to name one, and its answer is then checked against what exists —
    a model naming `python-fundamentals` does not make that pack exist. A miss
    goes to §7.1's Generated tier rather than being an error.
  - Signup is *not* currently deferred: `/start` requires a session. The
    anonymous Skill Check is the show-value-first surface, and it carries its
    result into the account (§24 E11).

### 4. Adaptive diagnostic — `/assess/{goalId}`
- **Purpose:** locate the learner on the skill graph in **8–12 minutes**, never more.
- **UI:** one item at a time, progress by *information gained* not item count ("Narrowing down… 70% confident"). Mix of MCQ, short free-text, "explain this," code-read, and one micro-artefact task. An always-visible "I don't know this" button (a fast, informative signal).
- **Interactions:** skip; abandon and resume; "this seems too easy/hard" feedback button.
- **Data:** `AssessmentItem` (from pack), `AssessmentResult`, seeds `LearnerSkillMastery`.
- **AI:** item **selection is deterministic** (max-information Elo/IRT-lite, §16.2). Only free-text grading is LLM (Haiku 4.5 for closed items, Sonnet 5 for open).
- **Ends with:** a genuinely useful free result page — "here's where you are, here's your gap" — *this* is the signup moment.

### 5. Generated learning path — `/goals/{id}/path`
- **Purpose:** the "wow", and the honest expectation-set.
- **UI:** skill graph visual (DAG, colour-coded: mastered / in progress / locked / skipped-because-you-know-it). Timeline against their weekly hours with an honest completion estimate and a confidence range. Milestones and the projects they'll produce. **Explicitly lists what was skipped and why** — this is the "don't waste my time" promise made visible, and it is a demo-able moment nobody else has.
- **Data:** `Curriculum`, `CurriculumModule`, `Skill`, `LearnerSkillMastery`, `LearningPlan`.
- **AI:** Skill Graph Builder (pack-seeded, personalised) + Curriculum Architect + **Curriculum Validator** (§14.6).

### 6. Daily dashboard — `/today`
- **Purpose:** the retention surface. Must answer "what do I do now" in under 2 seconds.
- **UI:** **one** primary card — today's session, with duration and what it will get them ("After this you'll be able to X"). Secondary: overdue retrieval items, pending evaluation results, streak, this week's hours vs. commitment. Nothing else. No feed, no browse.
- **Interactions:** Start · Not today (reschedule, no guilt) · I have less time (regenerates a shorter session) · Change plan.
- **Data:** `LearningPlan`, `LearningSession`, `Progress`.
- **AI:** the **Learning Planner** (§16), run asynchronously overnight so the page loads instantly from a precomputed plan.

### 7. Session / tutor — `/session/{id}`
- **Purpose:** 20–60 minutes of active learning. Never passive.
- **UI:** session composed of typed **blocks** — `explain` · `check` (retrieval question) · `apply` (exercise) · `review` (of prior work) · `reflect`. Persistent tutor chat in a side panel. Visible block progress. File/image/audio upload always available.
- **Interactions:** ask anything; "I don't understand" (triggers re-explain at a different level); "too easy" (skip ahead); pause and resume mid-session.
- **Data:** `LearningSession`, `Lesson`, `Exercise`, `Interaction`.
- **AI:** Lesson Generator (Sonnet 5, streamed) + Tutor (Sonnet 5 with cached learner-context prefix) + Practice Generator.
- **Rule enforcement:** application code refuses to compose a session that is >50% `explain` blocks. Active learning is a schema constraint, not a prompt suggestion.

### 8. Practice & project — `/practice/{id}`, `/project/{id}`
- **Purpose:** produce the artefact. **This is where the product earns its price.**
- **UI:** project brief; **the full rubric visible up front**; acceptance criteria as a checklist; submission zone accepting GitHub URL / file / paste / image / audio / video by evidence type. Draft-save. "Submit for evaluation."
- **Data:** `Project`, `Exercise`, `Submission`, `Artifact`.
- **AI:** Project Generator at creation; nothing at submission time (queued).

### 9. Evaluation result — `/submission/{id}`
- **Purpose:** the moment of value. Must feel like a senior person reviewed your work.
- **UI:** per-criterion scores against the published rubric, each with **a quoted excerpt from the actual artefact as evidence**. Overall verdict + confidence band + evidence tier badge. "What this proves you can do" / "What's still unproven." Specific next actions. **"I disagree" button** → structured dispute → re-evaluation with a different model and prompt; disputes feed the calibration set (§21).
- **Data:** `Evaluation`, `EvaluationCriterionResult`, `MasteryUpdate`.
- **AI:** the **Evaluation Agent** (§14.5) — Opus 5, adaptive thinking, question-specific rubric, plus a Sonnet 5 verifier pass.

### 10. Mastery map — `/mastery`
- **Purpose:** the reason to stay subscribed. Progress that means something.
- **UI:** skill graph coloured by mastery with confidence shading. Toggle: **"What I can do"** (evidence-backed capability statements, each linking to the artefact that proves it) vs **"What's left"**. Explicit decay indicator on skills not practised recently. Never a % complete.
- **Data:** `LearnerSkillMastery`, `Evaluation`, `Artifact`.
- **AI:** none at read time — capability statements are generated on mastery-threshold crossing and cached.

### 11. Progress & reflection — `/progress`
- **Purpose:** weekly re-motivation and honest recalibration.
- **UI:** weekly digest — hours vs. commitment, skills moved, artefacts produced, retention health, revised completion estimate. Plan-change proposals with reasons and an accept/reject control.
- **AI:** Reflection Agent (weekly batch, Sonnet 5 via Batch API at 50% cost).

### 12. Proof Page (public/shareable) — `/p/{handle}/{slug}`
- **Purpose:** the growth loop, and the artefact people actually want.
- **UI:** goal, duration, hours invested, skill list with evidence, projects with rubric scores, timeline. Owner controls: private (default) · unlisted link · public. Public pages are **`noindex` until they pass the quality gate** (§12): ≥3 evaluated artefacts, ≥1 completed project, non-trivial written reflection.
- **CTA:** *"Start your own — free skill check."*
- **Data:** `PublicLearningPath`, privacy flags, per-artefact redaction controls.
- **SEO:** unique, genuinely user-generated content — the only page type that can safely scale to thousands. §12.

### 13. Settings — `/settings`
Weekly hours, deadlines, notification cadence and channel, privacy defaults, data export (full JSON — a trust signal), billing, delete account.

---

# 8.5 Design Language

Calm, spacious, one idea per screen. This is a consumer product for adults who are not developers — it must not look like a dashboard, an IDE, or an analytics tool.

**We borrow Apple's *principles*, not their *visual language*.** The discipline is theirs; the identity is ours. Anyone who has used a phone should find this immediately legible without it feeling like an iOS app running in a browser.

## 8.5.1 The principles we take

| Principle | What it means here | What it forbids |
|---|---|---|
| **Content over chrome** | The learning material is the interface. Navigation and controls recede until needed. | Persistent sidebars · toolbars · panels within panels · decorative gradients |
| **Clarity over cleverness** | Legible at a glance; one action is obviously primary; plain language everywhere. | Icon-only buttons · abbreviations · jargon · anything needing a tooltip to understand |
| **Hierarchy through space** | Depth comes from layering, spacing and motion — not from dense visual encoding. | Colour-coded status grids · badge soup · borders as the main separator |
| **Progressive disclosure** | Show the next thing, not every thing. Detail is one tap away, never on screen by default. | Dashboards · settings walls · anything with a scrollbar at rest |
| **Deliberate restraint** | Few components, few sizes, one accent. Constraint *is* the aesthetic. | An expanding component library · a second accent hue · one-off layouts |

**The density rule — the single most important line in this section:** any screen showing more than **five** distinct pieces of information at rest is wrong. This is the mechanism that prevents drift back into a dev dashboard, and it should be enforced in design review, not hoped for.

## 8.5.2 What we deliberately do *not* take from Apple

Stated explicitly so it doesn't creep back in during implementation:

- ❌ **San Francisco / the system font stack** — that's Apple's voice, not ours
- ❌ **Apple's system palette** (`#007AFF` blue, `#F2F2F7` grey, `#34C759` green)
- ❌ **iOS component tics** — grabber handles, large-title-collapse-on-scroll, the exactly-four-item bottom tab bar, grouped inset lists with hairline separators
- ❌ **Heavy translucency and blur** — visually expensive, dates quickly, and costs paint performance on the pages where §13 demands speed
- ❌ **Bouncy overshoot springs** — iOS is playful; we want composed

Also avoided, because it is the *current default aesthetic of AI-generated frontends* and would read as templated: cream/off-white backgrounds around `#F4F1EA`, serif display type paired with a terracotta or amber accent, italic word-accents. Distinctive in 2024, generic now.

## 8.5.3 Our visual identity

**The idea:** *quiet instrument*. A precise, unshowy tool that gives you a straight answer. Cool neutral ground, near-black ink, and a single confident jade accent that carries the product's core semantic — **verified**.

```css
:root {
  /* Type — one family. Character comes from scale and tracking discipline,
     not from mixing typefaces or reaching for a display serif. */
  --font-sans: "Instrument Sans", "Instrument Sans Fallback", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;   /* code artefacts ONLY */

  /* Six sizes. Tight tracking on large sizes is where the character lives. */
  --text-hero:    clamp(2.5rem,6vw,4.5rem)/1.02 650 -0.04em;  /* marketing headline ONLY */
  --text-display: 2.5rem/1.1    650  -0.03em;   /* 40px — page + marketing titles */
  --text-title:   1.5rem/1.25   600  -0.02em;   /* 24px */
  --text-lead:    1.1875rem/1.5 400  -0.01em;   /* 19px — session content, intros */
  --text-body:    1rem/1.6      400   0;        /* 16px */
  --text-label:   0.875rem/1.4  550   0;        /* 14px — row labels, buttons */
  --text-meta:    0.8125rem/1.4 400   0.01em;   /* 13px — timestamps, captions */

  /* Colour — cool neutrals, never pure black or pure white on a surface */
  --ground:    #FAFAFA;   /* page */
  --surface:   #FFFFFF;   /* cards */
  --raised:    #FFFFFF;   /* panels, sheets */
  --ink:       #17191C;   /* primary text */
  --ink-muted: #5C6169;   /* secondary text */
  --ink-faint: #9AA0A8;   /* tertiary, placeholders */
  --hairline:  #E8E9EB;   /* only where space genuinely can't do the job */

  /* One accent. It means "verified" — the product's whole thesis. */
  --accent:      #00785C;   /* jade */
  --accent-weak: #E6F4F0;   /* tinted fill for accent surfaces */
  --attention:   #B26A00;   /* needs work / overdue — amber, used sparingly */
  --problem:     #B3261E;   /* failed / error — rose-red */

  /* No separate "success" colour. Verified IS the accent. This keeps the
     palette to three hues and makes the accent semantically load-bearing. */

  /* Geometry — slightly softer than iOS, on a 4px rhythm */
  --radius-control: 12px;  --radius-card: 18px;  --radius-pill: 999px;
  --space: 4px;            /* use 8/12/16/24/32/48/64/96 */
  --touch-min: 44px;       /* non-negotiable on mobile */
  --measure: 68ch;         /* max reading width */

  /* Elevation — two shadows, used rarely. Space separates; shadow lifts. */
  --shadow-raised: 0 1px 2px rgb(23 25 28 / .04), 0 12px 32px rgb(23 25 28 / .07);
  --shadow-lifted: 0 2px 4px rgb(23 25 28 / .05), 0 24px 56px -12px rgb(23 25 28 / .16);
}

/* Dark values — see §8.5.4 for how these are applied */
--ground: #0E1013;  --surface: #16191D;  --raised: #1D2126;
--ink: #F2F3F4;  --ink-muted: #A2A9B2;  --ink-faint: #6B727B;
--hairline: #262A2F;
--accent: #35C79A;  --accent-weak: #12302A;
--attention: #E0A33C;  --problem: #F2726A;
--shadow-raised: 0 1px 2px rgb(0 0 0 / .3), 0 12px 32px rgb(0 0 0 / .35);
--shadow-lifted: 0 2px 4px rgb(0 0 0 / .4), 0 24px 56px -12px rgb(0 0 0 / .6);
```

**Two amendments made during the landing-page rebuild**, both scoped to marketing and both because the original rule produced a page that was correct and dull:

- **`--text-hero` is a seventh size.** The six-size rule governs *product screens*, where a seventh is drift. But `--text-display` at a fixed 2.5rem is only 2.5× body, so on a desktop viewport the landing headline had no more presence than a section heading. Hero is fluid, so a phone still renders it at the scale's 2.5rem. **Marketing headline only — never on a product screen.**
- **`--shadow-lifted` is a second elevation.** "One shadow" holds wherever space separates. It fails in exactly one place: a `--surface` card on the `--accent-weak` field measures **1.13:1** in light, so without a deeper shadow the card has no edge at all. **Marketing showcase surfaces only.**

Both are pinned by tests in `tests/lib/theme.test.ts`, and both appear on `/design` so the drift guard can see them.

**`--accent-weak` is now a reading surface, not just a tint.** The landing page uses it as a full-bleed field, which puts it under the same contrast bar as any other surface. Measured: `--ink` 15.6:1 light / 12.8:1 dark, `--ink-muted` 5.5 / 6.0, `--accent` 4.8 / 6.6 — all pass. **`--ink-faint` does not** (4.15 / 3.96), so 13px meta text on the field steps up to `--ink-muted` via `Meta`'s `tone` prop. This is asserted rather than remembered.

**Typeface rationale.** [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) — open source, variable, geometric-humanist with just enough quirk to be recognisable, and crucially *not* Inter, Roboto, Geist or a system stack, all of which read as unbranded defaults. *(Alternate if you want more warmth: General Sans from Fontshare. Alternate if you want more neutrality: Public Sans.)* Self-host, subset to Latin, ship **two weights only** (400/600 from the variable file), `font-display: swap`, and define a metric-matched `Instrument Sans Fallback` via `size-adjust` so there is no layout shift — that keeps the §13 CLS < 0.05 and LCP < 2.0s targets intact at roughly 28KB.

**Accent rationale.** Jade is uncommon in this category (competitors are overwhelmingly blue or purple), it reads as *growth* and *pass* rather than *corporate*, and folding "success" into the accent means the palette is three hues total. Rebranding is one token.

## 8.5.4 Light and dark themes

**Both are first-class.** Dark is not a filter applied to light, and light is not an afterthought — every screen is designed and reviewed in both.

### Three states, not two

**Light · Dark · System (default).** System is the default because most people already made this choice at the OS level; asking them again is friction. Only an explicit choice writes `data-theme`.

### Token application

```css
:root {
  color-scheme: light;
  /* …light tokens from §8.5.3… */
}

/* System preference — applies unless the user explicitly chose light */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; /* …dark tokens… */ }
}

/* Explicit choice — must also win when the OS says light */
:root[data-theme="dark"] { color-scheme: dark; /* …dark tokens… */ }
```

Both dark blocks carry the **same** values. Author them **once** — define the two palettes as a TypeScript object and emit both blocks from a Tailwind plugin at build time. Hand-maintaining two copies of a palette is how themes silently diverge.

`color-scheme` is not optional: it makes native scrollbars, form controls, `<select>` menus and the browser's own UI match the theme. Omitting it is the most common reason a dark page still has white scrollbars and blinding date pickers.

### No flash of the wrong theme

Critical here, because §13.1 statically generates every marketing page — the server has no idea what theme the visitor wants.

- A **blocking inline script in `<head>`**, before any stylesheet or paint, reads the stored preference and sets `document.documentElement.dataset.theme`. Inline, not a module, not deferred, under ~400 bytes.
- `suppressHydrationWarning` on `<html>` so React doesn't complain about the attribute the script added.
- Mirror the preference to a **cookie** as well as `localStorage`, so dynamic app routes can server-render the correct theme and skip the script's work entirely.
- Preference changes apply instantly with no reload and no transition flash — suppress transitions for one frame while swapping.

### Dark is not inverted light

| Concern | Light | Dark |
|---|---|---|
| **Elevation** | Shadow lifts a surface off the ground | Shadows are nearly invisible — elevation comes from **lighter surfaces** (`--ground` → `--surface` → `--raised`). Shadow only deepens the separation. |
| **Text** | `--ink` is near-black, never `#000` | `--ink` is `#F2F3F4`, **never pure white** — pure white on dark causes halation and eye strain |
| **Accent** | `#00785C` — dark enough for text on white | Brightens to `#35C79A` to hold contrast on a dark ground |
| **Hairlines** | Slightly darker than the surface | Slightly *lighter* than the surface |
| **Large fills** | Saturated fills are fine | Reduce saturated area — large bright fills glare. Prefer `--accent-weak` tints and accent-coloured text/borders. |

### Learner artefacts always render at true colour

Product-specific and load-bearing: a photograph, screenshot, chart or design **being evaluated** must never be dimmed, inverted, tinted or filtered by the theme — the grade depends on how it actually looks, and a dark-mode filter would make the verdict wrong. Artefact viewers and Proof Page media sit on a **fixed neutral mat** (mid-grey, identical in both themes) with no theme-dependent treatment. This applies to the evaluation screen, the mastery evidence links and the public Proof Page.

### Contrast and verification

WCAG 2.2 AA in **both** themes: 4.5:1 for body text, 3:1 for large text and for the boundaries of interactive components. Run axe or Pa11y against the `/design` route in **both** themes in CI. The two pairs most likely to fail are `--ink-faint` on `--surface` and `--attention` on `--ground` — check those first, and treat any failure as a token bug rather than adjusting a single component.

### Where the control lives

**Settings → Appearance**, as a three-way toggle group (Light / Dark / System). On marketing pages, a small control in the footer. **Never a floating widget, never in primary chrome** — theme switching is a once-a-year action and should not occupy permanent space.

### Deliberately single-theme

- **OG / social preview images** — platforms don't respect viewer theme; ship the light version only
- **Favicon** — one mark that reads on both light and dark browser chrome
- **Emails** — dark-mode email client support is inconsistent and partially broken; design one version that survives both

### Testing

Visual-regression snapshots of `/design` and every key screen in **both** themes, plus one screen in each of the three preference states to prove the toggle overrides the OS in both directions. Dark mode is where colour bugs hide; a light-only screenshot suite will not find them.

## 8.5.5 Component vocabulary

Deliberately small — roughly 18 components carry the entire product. Named for what they do, not after a platform.

| Use | Component | Not |
|---|---|---|
| Any collection of skills, sessions, submissions, settings | **Row list** — a card containing full-width rows; separated by space and a subtle background shift, hairlines only where space genuinely fails | ❌ Data table |
| Switching between 2–4 views | **Toggle group** — text labels in a pill track | ❌ Tabs, ❌ dropdown |
| Primary action | **One filled button per screen.** Full-width on mobile, intrinsic width on desktop | ❌ Rows of equal-weight buttons |
| Secondary action | Text button in `--accent`, no border, no fill | ❌ Outlined button |
| Anything modal | **Panel** — bottom-anchored on mobile, centred on desktop; dismiss by backdrop, Esc or an explicit Close | ❌ Nested modals, ❌ drag handles |
| Boolean setting | **Switch** | ❌ Checkbox |
| Page heading | Static display title with generous space above. No collapse-on-scroll, no sticky bar in-app | ❌ Breadcrumb chrome in-app |
| Mobile nav | **Bottom bar**, 3 destinations: Today · Path · You | ❌ Hamburger, ❌ sidebar |
| Desktop nav | Same 3 in a quiet left rail — icon + label, flat, no nesting | ❌ Expandable tree |
| Status | A **dot plus a word** (`● Verified`) | ❌ Badges, ❌ count pills |
| Confidence | A **three-segment meter plus a word** (`Likely capable`) — never a number | ❌ Percentages, ❌ star ratings |
| Loading | Skeleton matching the final layout exactly | ❌ Spinners |
| Empty state | One sentence and one button | ❌ Illustration and a paragraph |

**Banned outright:** data tables · percentage progress bars (already a product rule, §4.2) · dense metric grids · monospace outside code artefacts · colour as the sole carrier of meaning · tooltips that explain an icon · a second accent hue · any component not on this list without a deliberate addition to it.

## 8.5.6 Motion

Spring-based, but composed rather than playful — settle without visible bounce.

```css
--ease-spring: linear(0,.0067,.0265,.0587,.1021,.1553,.2168,.2851,.3587,.4361,
                      .5157,.5961,.6757,.7531,.8269,.8956,.9578,1.0116,1.0553,
                      1.0872,1.0951,1.0784,1.0435,1.0139,1);
--ease-out:    cubic-bezier(.22,.61,.36,1);
--dur-fast: 160ms;  --dur-base: 240ms;  --dur-panel: 320ms;
```

Rules: things **grow from where they were tapped** — a row expands into the screen it opens · nothing translates more than 20px except a panel · list items stagger 24ms on first render only, never on re-render · state changes cross-fade, they don't slide · **`prefers-reduced-motion: reduce` collapses everything to a 100ms opacity fade.**

## 8.5.7 Reconciling restraint with two hard requirements

Two places where "extremely simple" genuinely conflicts with the plan, and the resolution:

**1. The Mastery Map shows 40 skills with confidence bands.** Inherently dense.
→ Default view shows **only the skills that moved this week** plus one sentence: *"You can now do 12 things. 8 to go."* Everything else sits behind a "See all skills" row. The full graph is its own screen, never a widget. Progressive disclosure, not information compression.

**2. SEO pages need 12 content sections (§11).** That's a long page.
→ Long is fine; *dense* is not. Display-size headings, one idea per scroll band, `--measure` reading width, 64–96px between sections, sticky contents on desktop. Content depth is fully preserved and visual density stays low — which also helps dwell time and mobile usability scores.

## 8.5.8 Implementation

- **Tailwind, token-restricted.** Delete the default palette, spacing scale, radius scale and font stack from `tailwind.config` and expose *only* the tokens above. An unrestricted Tailwind config is precisely how a design drifts back into a dev dashboard.
- **Take shadcn's code, not its look.** Its components are Radix primitives copied into your repo — keep them for the accessibility and keyboard behaviour, then replace every default class with our tokens. Building ~18 components from bare Radix costs an extra day for the same outcome; not worth it inside a 30-day build.
- **Motion:** `motion` (Framer Motion) for panels and shared-element transitions only; CSS `linear()` easing everywhere else so the marketing routes ship no motion JS.
- **Marketing routes ship zero component-library JS** — §13.1 caps them at 80KB. Every marketing-side pattern above is achievable in pure CSS, and must be.
- **Light and dark are both first-class** — full spec in §8.5.4. Palettes authored once in TS and emitted to both selector blocks by a Tailwind plugin; inline anti-FOUC script in `<head>`; `color-scheme` set on `:root`; CI contrast checks in both themes.
- **Ship a `tokens.css` and a `/design` reference route in week 1**, before any product screen. Rendering the full component set on one page is the cheapest possible guard against drift, and it doubles as the visual-regression target.

## 8.5.9 Page composition

Added after the first full pass of marketing pages shipped. Every rule in §8.5.1–8.5.8 was being followed, and the result was still dull — because restraint was being applied to *content* while nothing at all was being said about *composition*. Six pages came out as one narrow column of same-weight text.

**The failure mode, precisely:** "calm" was read as "flat". A page with no elevation, no width variation, no colour field and no entrance is not calm; it is unfinished. Restraint is a constraint on how many things you use, not on whether the page has a shape.

| Rule | Why |
|---|---|
| **One frame: `max-w-5xl`, one vertical rhythm.** `PageFrame` owns it | Pages had picked `max-w-2xl` and `max-w-3xl` independently. Nobody notices on one page; everybody feels it across four |
| **Every card carries elevation.** `Card` or `LinkCard`, never bare `bg-surface` | `--surface` on `--ground` is a **2% value step** in light. A card without a shadow is not a card |
| **Hover lifts, it never tints.** `--shadow-raised` → `--shadow-lifted`, no `hover:bg-accent-weak` | The accent means *verified*. A card is not verified because you pointed at it |
| **Collections are responsive grids**, not single-column stacks | A 26-item column is a scroll; a 3-column grid is a map |
| **Sections open with a `SectionHead`** — numbered eyebrow, display-size title | A bare `Title` over prose at the same weight is what makes a page read as one long list |
| **First paint staggers.** `rise` + `stagger(i)`, 24ms, capped at 8 | §8.5.6, and it costs zero JS. Uncapped, the 26th row lands 600ms late |
| **`--text-hero` is the landing page only.** Everything else opens with `DisplayTitle` | If every page shouts, the landing page cannot |
| **Meta text on `--accent-weak` uses `tone="muted"`** | `--ink-faint` measures 4.15:1 there — under the 4.5:1 bar 13px text is held to |

**One documented exception — task screens keep the narrow column.** The running skill check (`PageFrame narrow`), goal setup, sign-in and Today are things you *do*, not things you read: one question or one form on screen and nothing else. §8.5.1's "one idea per screen" beats a consistent width there, and a goal form read across 1024px would be worse, not better. Everything a visitor *reads* — the four marketing routes — uses the full frame.

**The density rule still holds.** §8.5.7 already licenses the length ("Long is fine; *dense* is not"), and none of the above adds a thing to read: it adds shape to what is already there. Four scroll bands with one idea each is not five things at rest.

---

# 9. SEO Strategy

## 9.1 The core strategic call

**Do not build a content site. Build a tool site with content around it.**

You cannot out-article DataCamp, Coursera or roadmap.sh. You can out-*tool* them, because they have no incentive to build interactive assessments that expose gaps their courses can't fill. Tools attract links, resist AI-content classification by construction, and convert an order of magnitude better than articles.

**Page-type priority:**

| Priority | Type | Count Y1 | Index? | Why |
|---|---|---|---|---|
| **1** | `/check/{skill}` — free interactive skill assessment | 40 → 200 | ✅ | Thin, dated SERP. High commercial intent. Tools, not text. Naturally linkable. |
| **2** | `/projects/{slug}` — graded project brief + public rubric | 40 → 300 | ✅ | Content nobody else has. Strong long-tail. Doubles as a product asset. |
| **3** | `/learn/{topic}-for-{audience}` — "X for people who know Y" | 30 → 150 | ✅ | Real intent, low competition, natural fit for your personalization pitch. |
| **4** | `/guides/{question}` — problem & time-based queries | 25 → 100 | ✅ | Conversational long-tail; strong AI-Overview citation candidates. |
| **5** | `/tools/*` — roadmap generator, time calculator, gap analyzer | 5 → 10 | ✅ | Link magnets. |
| 6 | `/learn/{topic}` — broad head guides | 20 | ✅ (slow burn) | Won't rank for 18 months. Build for topical authority and internal linking, not traffic. |
| 7 | `/roadmaps/{career}` | **6 only** | ✅ | roadmap.sh owns this. Only build long-tail variants they lack. |
| 8 | `/p/{handle}/{slug}` — Proof Pages | unbounded | ⚠️ Gated | Only after the quality gate. §12. |
| — | `/skills/{skill}` bare pages | 0 | ❌ | Thin by nature. **Redirect to `/check/{skill}`.** |
| — | Skill × level × time combinatorial pages | 0 | ❌ | **Do not build.** This is the content farm. §12. |

## 9.2 What I explicitly recommend against

- **`/learn/python-in-30-days`, `/learn/python-30-minutes-a-day`, and the whole timeframe/duration matrix.** These are near-duplicates of `/learn/python` with a number swapped. This is the textbook shape Google's [March 2026 scaled-content-abuse enforcement hit for 60–90% ranking losses](https://www.digitalapplied.com/blog/scaled-content-abuse-google-march-update-ai-pages-decimated). Serve the intent as **a parameter on the tool**, not as a URL. `/tools/learning-time-calculator?skill=python&hours=5` — canonical to the bare tool URL, `noindex` on parameterised variants.
- **Skill × goal matrices at scale** ("Python for X" × 200 values of X). Build the 8 where the *curriculum genuinely differs*; skip the rest.
- **Blindly launching 500 pages.** Publish 50 excellent pages, measure for 90 days, then scale only the templates that earned impressions.

## 9.3 Topical authority plan

Three tight clusters at launch, not fifty scattered pages. Each is a hub-and-spoke: one pillar `/learn/{topic}`, 8–12 spokes (`/check`, `/projects`, `/guides`), bidirectional internal links, one shared free tool.

**Launch clusters:** (1) Python & data analysis · (2) AI/ML engineering · (3) SQL & data literacy.
**Then, one new cluster per month**, in Curated-pack order (§7.1). Never start a cluster you can't finish in 3 weeks.

---

# 10. SEO Content Plan — the exact first 50 pages

Grouped by template. **Every one of these must be volume-verified in week 1 (§2.6) and dropped if all three top-ranking results are DR>60 or the volume is under ~150/mo.** Priority column: P1 = ship in weeks 1–4.

### A. Interactive Skill Checks — `/check/{skill}` (16 pages, all P1)
`python` · `sql` · `javascript` · `excel` · `machine-learning` · `data-analysis` · `react` · `statistics` · `git` · `aws-cloud` · `cybersecurity-fundamentals` · `pandas` · `seo` · `financial-modelling` · `business-writing` · `product-management`

Target intent: *"test my X level"*, *"X skill test"*, *"am I good at X"*, *"X assessment free"*. Each page: the working 10-question adaptive check runs **without signup**, produces a level + gap breakdown, then converts.

### B. Graded Project Briefs — `/projects/{slug}` (14 pages, P1/P2)
`build-a-rag-system` · `data-cleaning-pipeline-python` · `sql-analytics-report-from-raw-data` · `personal-finance-model-excel` · `react-dashboard-with-real-api` · `train-a-classifier-end-to-end` · `deploy-an-ml-model-as-an-api` · `write-a-product-spec` · `run-a-technical-seo-audit` · `three-point-financial-model` · `ab-test-design-and-analysis` · `secure-a-vulnerable-web-app` · `photograph-in-manual-mode-series` · `five-minute-persuasive-talk`

Each: brief, **full public rubric**, acceptance criteria, common failure modes, worked example of a passing vs. failing submission, prerequisites, "get this graded free" CTA. **Nobody in this space publishes rubrics. This is your unique content.**

### C. "For people who already know Y" guides — `/learn/{topic}-for-{audience}` (10 pages, P2)
`machine-learning-for-software-engineers` · `python-for-excel-users` · `sql-for-product-managers` · `statistics-for-developers` · `ai-engineering-for-web-developers` · `data-analysis-for-marketers` · `finance-for-engineers` · `python-for-data-analysts` · `cloud-for-backend-developers` · `writing-for-technical-people`

Explicitly personalized-curriculum pages: what to skip because you already know it, what transfers, what's genuinely new. This directly demos the product thesis.

### D. Problem & time intent — `/guides/{question}` (10 pages, P2/P3)
`how-long-does-it-take-to-learn-python` · `how-long-does-it-take-to-learn-machine-learning` · `why-am-i-stuck-in-tutorial-hell` · `what-should-i-learn-after-python-basics` · `how-do-i-know-if-im-actually-improving` · `self-taught-vs-bootcamp` · `how-many-hours-a-week-to-learn-a-new-skill` · `portfolio-projects-that-actually-get-interviews` · `best-way-to-learn-a-skill-as-an-adult` · `why-do-i-forget-what-i-learn`

Each answers in the first 60 words (AI Overview / featured-snippet shape), backs it with an interactive calculator or check, and cites learning-science sources.

### E. Free tools — `/tools/{tool}` (4 pages, P1)
`learning-roadmap-generator` · `skill-gap-analyzer` · `learning-time-calculator` · `what-should-i-learn-next`

### F. Roadmaps — `/roadmaps/{slug}` (6 pages only, P3)
`ai-engineer-for-experienced-developers` · `data-analyst-career-change` · `self-taught-developer-with-a-full-time-job` · `ml-engineer-part-time-6-months` · `analyst-to-data-scientist` · `marketer-to-growth-engineer`

**Deliberately not** `frontend-developer`, `backend-developer`, `devops`, `ai-engineer` — roadmap.sh owns those; do not spend a page on them.

### Local-language beachhead
Same architecture under a `/{lang}/` path segment with correct `hreflang` + `x-default`. **Translate only the 15 best-performing English pages, and hand-write 5 locale-native pages** (local job market, local salaries, local certification bodies) — translations alone rarely rank. Selection criteria for the language: you write it natively, 3M+ speakers, near-zero AI-learning competition. **Do this in month 4, not month 1** — do not split a solo founder's content effort before the English cluster shows traction.

---

# 11. SEO Page Experience

A `/learn/*` or `/check/*` page is **not** a 2,000-word article. Required structure, in order:

1. **H1 + a 40–60 word direct answer** (AI Overview / snippet target)
2. **The interactive tool, above the fold**, working, no signup — the check, the calculator, or the roadmap generator
3. **Realistic time estimate** with an explicit range and stated assumptions
4. **Prerequisites** — linked to their own `/check/*` pages
5. **The skill breakdown** — the actual sub-skills, rendered from the skill graph, each linked
6. **Three level paths** (beginner / intermediate / advanced) with what differs
7. **Example curriculum** — a real week-by-week from a Curated pack, not filler
8. **Practical projects** — linked to `/projects/*` with their rubrics
9. **Common mistakes** — specific, from real submission failure data once you have it. *This is the section that will be uniquely yours.*
10. **Recommended resources** — genuinely curated, external, with honest one-line assessments (link out; it builds trust and Google rewards it)
11. **FAQ** — 5–8 real questions, `FAQPage` JSON-LD
12. **Personalized CTA:** *"This is the generic path. Want one built on what you already know?"* → free check

**Quality bar, enforced by the gate in §12:** if a page would be useful to someone who never signs up, it ships. If it's a lead-gen shell, it doesn't.

---

# 12. Avoiding the Content Farm — Quality Control

**The risk is real and you named it correctly.** [Google's scaled-content-abuse policy is method-agnostic](https://patrickstox.com/programmatic-seo/risks/scaled-content-abuse/) — it targets intent (ranking manipulation) and outcome (low value), not whether AI wrote it. Sites publishing 1,000+ unedited AI pages saw 40–90% traffic drops; sites publishing 50–100 quality AI-assisted, human-edited pages saw increases. Enforcement was algorithmic — **no Search Console notification**.

## 12.1 Structural defences (better than any scoring rubric)

1. **Ship 50 pages, not 5,000.** The volume itself is the strongest signal you're not a farm.
2. **Every indexable page contains a working tool or unique data.** A page whose value is a functioning adaptive assessment or a published grading rubric is not "scaled content" in any meaningful sense.
3. **Programmatic generation is banned for prose.** Templates render *structure* from database entities (skills, prerequisites, rubric criteria, real time estimates). The narrative sections are hand-written or hand-edited, every time.
4. **`noindex` by default.** A page is `index,follow` only after passing the gate *and* receiving explicit human approval. `SeoPage.indexable` is a boolean you flip, not a default.
5. **No page ships without a human read.** At 50 pages that's ~10 hours. It is the cheapest insurance available.

## 12.2 The automated Content Quality Score

Computed at generation, blocks publication below threshold. Score 0–100; **indexable requires ≥75 AND human approval.**

| # | Dimension | Weight | Automated check |
|---|---|---|---|
| 1 | **Factual validation** | 15 | Every factual claim traceable to a `Resource` with a URL; time estimates cross-checked against ≥2 authoritative sources; a Haiku 4.5 claim-extraction pass flags unsourced assertions |
| 2 | **Uniqueness** | 15 | Cosine similarity of embeddings vs. every other page in the corpus **must be < 0.80**; 5-gram overlap with the top 10 SERP results < 15% |
| 3 | **Search-intent match** | 10 | SERP-type classification (article / tool / forum / video) must match the page type being shipped |
| 4 | **Topical completeness** | 10 | All 12 required sections (§11) present and non-empty; skill breakdown has ≥5 skills |
| 5 | **Useful examples** | 10 | ≥1 concrete worked example; ≥1 real project brief with a rubric |
| 6 | **Source quality** | 10 | ≥3 external links to non-competitor authoritative sources; every one HTTP-200 verified at build |
| 7 | **Originality / experience signal** | 10 | Contains ≥1 data point only you have (aggregate submission failure rates, real completion times from your own users, rubric criteria). **After month 3 this becomes mandatory, not scored.** |
| 8 | **Internal linking** | 8 | ≥4 outbound internal links to relevant pages; ≥2 inbound from existing pages (measured post-publish) |
| 9 | **Conversion quality** | 7 | Tool present and functional; CTA specific to the page topic, not generic |
| 10 | **Readability & structure** | 5 | Heading hierarchy valid; no section >400 words unbroken; scannable |

**Standing rules:**
- Automated re-scoring monthly. Any live page dropping below 70 is auto-`noindex`ed and queued for review.
- **Any indexed page with 0 clicks and <50 impressions after 6 months is pruned or merged.** Index bloat is a sitewide quality signal.
- After month 3, every page must contain proprietary data (dimension 7 becomes a gate). This is your permanent structural defence: pages built on your own aggregate learner data cannot be replicated by a competitor with an LLM.

---

# 13. Technical SEO Architecture

## 13.1 Next.js structure — one app, two rendering worlds

```
app/
├─ (marketing)/                 # Fully static / ISR. No auth. No client JS beyond the tools.
│  ├─ page.tsx                              # /
│  ├─ learn/[topic]/page.tsx                # generateStaticParams + revalidate 86400
│  ├─ check/[skill]/page.tsx                # static shell + client island for the check
│  ├─ projects/[slug]/page.tsx
│  ├─ guides/[slug]/page.tsx
│  ├─ roadmaps/[slug]/page.tsx
│  ├─ tools/[tool]/page.tsx
│  └─ p/[handle]/[slug]/page.tsx            # Proof Pages, ISR 3600
│
├─ (app)/                       # Authenticated SaaS. Dynamic. noindex via metadata.
│  ├─ layout.tsx                            # robots: { index: false, follow: false }
│  ├─ today/ · goals/[id]/ · session/[id]/ · mastery/ · submission/[id]/ · settings/
│
├─ api/                         # Route handlers: streaming AI, webhooks, tool endpoints
├─ sitemap.ts                   # index + per-type child sitemaps
├─ robots.ts
└─ opengraph-image.tsx          # dynamic OG per page type
```

**Why this split works:** the marketing segment has no auth provider in its React tree, so it renders fully at build time with near-zero JS — Core Web Vitals are excellent by construction. The app segment is dynamic and `noindex`ed at the layout level, so no authenticated route can leak into the index by accident.

**Known trap:** Next.js 15 metadata streaming can place `<head>` tags after body content in some versions, which breaks crawler parsing. **Verify with `curl` on the raw HTML — not the browser DOM — before launch, and pin the Next version.**

## 13.2 URL structure

| Pattern | Purpose | Canonical rule |
|---|---|---|
| `/learn/{topic}` | Topic guide | Self |
| `/learn/{topic}-for-{audience}` | Audience variant | Self (genuinely different content) |
| `/check/{skill}` | Skill assessment | Self |
| `/projects/{slug}` | Project brief + rubric | Self |
| `/guides/{slug}` | Question intent | Self |
| `/roadmaps/{slug}` | Career roadmap | Self |
| `/tools/{tool}` | Free tool | Self; **all query params canonical to the bare URL** |
| `/p/{handle}/{slug}` | Proof Page | Self if public+gated; else `noindex` |
| `/{lang}/...` | Beachhead locale | Self + full `hreflang` cluster incl. `x-default` |
| `/skills/{skill}` | — | **301 → `/check/{skill}`** |

Lowercase, hyphenated, no trailing slash, no dates, no IDs. Slugs immutable once indexed; renames get a permanent 301.

## 13.3 Technical checklist

| Item | Implementation |
|---|---|
| **Rendering** | `generateStaticParams` + ISR (`revalidate: 86400`) for all marketing routes. Never client-render indexable content. |
| **Metadata** | `generateMetadata` per route from the `SeoPage` record. Title ≤60ch, description 140–160ch, both stored in DB and human-edited. |
| **Canonical** | `alternates.canonical` set explicitly on every page. Never rely on defaults. |
| **Robots** | `app/robots.ts`: allow marketing, `Disallow: /api/`, `/today`, `/session`, `/goals`, `/settings`, `/submission`. Sitemap reference. |
| **Sitemaps** | `sitemap.ts` emits a sitemap index + child sitemaps per page type, <10k URLs each. **Only `indexable: true` pages included** — this is the single most important crawl-budget control. Accurate `lastModified` from DB. |
| **JSON-LD** | `Organization` + `WebSite`+`SearchAction` (root) · `Course` (`/learn`, only where a real structured curriculum exists) · `HowTo` (`/projects`) · `FAQPage` (where a real FAQ exists) · `Quiz`/`LearningResource` (`/check`) · `WebApplication` (`/tools`) · `BreadcrumbList` (everywhere) · `Person`+`CreativeWork` (Proof Pages). **Never mark up content that isn't visibly on the page.** |
| **Breadcrumbs** | Visible + `BreadcrumbList` markup. Home → Category → Page. |
| **Internal linking** | `InternalLink` table with typed edges (`prerequisite`, `next_step`, `related`, `project_for`, `check_for`). Rendered contextually, not as a footer link dump. **Rule: every page has ≥4 out and ≥2 in.** |
| **Pagination** | Avoid entirely for indexable content. Directory pages use filtered static routes, not `?page=`. |
| **Faceted nav** | **`noindex` on every faceted/filtered/parameterised URL.** Canonical to the bare view. Non-negotiable — this is the #1 index-bloat source. |
| **Site search** | `/search` is `noindex,follow`. |
| **Crawl budget** | Sitemap contains only indexable pages; faceted URLs `noindex`; app routes disallowed; 301 chains eliminated; IndexNow ping to Bing on publish. |
| **Images** | `next/image`, AVIF+WebP, explicit width/height (CLS), lazy below fold, `priority` on the LCP image, descriptive alt from DB. |
| **Core Web Vitals** | LCP <2.0s (static + preloaded font + optimised hero), INP <200ms (assessment islands hydrate independently; no blocking JS), CLS <0.05 (reserved space for every dynamic element). Marketing routes ship <80KB JS. |
| **Mobile** | Mobile-first CSS; 44px tap targets; the skill check must be genuinely pleasant on a phone (it's the conversion surface). |
| **OG / Twitter** | Dynamic `opengraph-image.tsx` per type. Proof Pages get a generated card showing goal + skills + hours — designed for sharing. |
| **Monitoring** | GSC + Bing WMT from day one. Weekly: coverage, CWV, query-level CTR. Alert on any indexed→excluded transition. |

---

# 14. AI Architecture

## 14.1 The organising principle

> **Deterministic planner. LLM sensors and actuators.**

The LLM never decides *what the learner should do next*. It converts unstructured input into structured observations (sensor), and converts structured decisions into content (actuator). The decision itself is code. This makes the core loop debuggable, testable, cheap, consistent across runs, and independent of model changes — and it is precisely what the thin-wrapper competitors don't do.

## 14.2 Which components are actually agents

| Component | Real agent? | Implementation | Model | Sync? |
|---|---|---|---|---|
| **Goal Analyzer** | ⚠️ Light | Structured-output loop, hard cap of 6 turns | Sonnet 5 | Sync (form POST, not streamed — the screen has no client JS) |
| **Learner Profiler** | ❌ | Deterministic aggregation over events | — | — |
| **Assessment Agent** | ❌ **Code** | IRT-lite item selection from the pack's bank | Haiku 4.5 *only* to grade free-text | Sync |
| **Skill Graph Builder** | ⚠️ Build-time | Pack seed + personalized pruning; **not** per-request generation | Opus 5 (authoring) | Async |
| **Curriculum Architect** | ⚠️ | Single structured call over the pruned graph + constraints | Sonnet 5 | Async (30–60s, with progress UI) |
| **Curriculum Validator** | ✅ **Yes, and essential** | Multi-check adversarial pass over the generated curriculum (§14.6) | Opus 5 | Async |
| **Resource Researcher** | ✅ | Web search + fetch tools, verify-and-cite | Sonnet 5 + `web_search_20260209` | Async, batched |
| **Lesson Generator** | ❌ | One templated call per block | Sonnet 5 | Sync, streamed |
| **Tutor** | ❌ | Chat with cached learner-context prefix | Sonnet 5 | Sync, streamed |
| **Pack Graph Author** | ⚠️ Light | Skills + dependency order for an uncurated subject | **Opus 5** | Async (Inngest) |
| **Pack Item Author** | ❌ | Assessment items, batched by skill area | Sonnet 5 | Async (Inngest) |
| **Pack Rubric Author** | ❌ | Projects + rubrics for a generated pack | Sonnet 5 | Async (Inngest) |
| **Practice / Project Generator** | ❌ | Structured call, rubric attached | Sonnet 5 | Async, pre-generated |
| **Evaluation Agent** | ✅ **Yes — the crown jewel** | Multi-pass, tool-using, rubric-anchored (§14.5) | **Opus 5**, adaptive thinking | Async, 30–120s |
| **Mastery Model** | ❌ **Pure code** | BKT + decay (§16) | — | — |
| **Learning Planner** | ❌ **Pure code** | Deterministic scoring (§16) | — | Nightly batch |
| **Reflection Agent** | ❌ | Weekly summarisation | Sonnet 5 via **Batch API (50% off)** | Async |
| **SEO Content Planner** | ⚠️ | Human-in-loop keyword→brief | Opus 5 | Offline |
| **SEO Content Generator** | ❌ | Templated section generation | Opus 5 | Offline |
| **SEO Quality Evaluator** | ❌ | Deterministic scorer (§12.2) + one LLM claim-check | Sonnet 5 | Offline |

**Only three real agents: Curriculum Validator, Resource Researcher, Evaluation Agent.** Everything else is a structured call or plain code. Resist the urge to agentify — each agent you add multiplies latency, cost and failure modes.

## 14.3 Context management & memory

Three tiers, deliberately separated:

1. **Learner Context Block** — a compact, deterministic ~1,200-token render of: goal spec, profile, top-15 skill mastery states, last 3 session outcomes, active misconceptions, constraints. **Regenerated only on state change**, placed at the top of every prompt behind a `cache_control` breakpoint. This is the single biggest cost lever in the system — cache reads are ~0.1× input price.
2. **Session working context** — the current session transcript, trimmed to the last N blocks.
3. **Durable memory** — Postgres. `Interaction`, `Evaluation`, `LearnerSkillMastery`, `Misconception`. **Structured rows, not a vector blob.** The learner model must be queryable and auditable, not "remembered."

**Prompt cache discipline** (this is worth real money): frozen system prompt with zero interpolation; deterministic tool ordering (sorted by name); `JSON.stringify` with sorted keys; no timestamps or UUIDs anywhere in the prefix; volatile content strictly after the last breakpoint. Assert `cache_read_input_tokens > 0` in staging tests — a silent cache miss can triple your bill without any error.

## 14.4 Skill graph & curriculum representation

```ts
Skill {
  id, packId, slug, name, description
  level: 'foundational'|'core'|'advanced'|'specialist'
  evalTier: 1|2|3|4|5
  estimatedHours: number
  bktPriors: { pInit, pLearn, pSlip, pGuess }   // expert-seeded, later fitted
  canDoStatement: string                         // "Write a SQL query joining 3 tables with correct grain"
  observableEvidence: EvidenceType[]
}

SkillDependency { fromSkillId, toSkillId, type: 'hard'|'soft', strength: 0..1 }
```

`hard` = cannot learn without. `soft` = easier with. The planner treats them very differently (§16.1). A DAG, cycle-checked at pack build time; a cycle is a build failure.

Curriculum = an ordered list of `CurriculumModule`s, each targeting 1–3 skills with a defined output artefact. **The curriculum is a cached projection of the plan, never the source of truth.** The source of truth is (skill graph × mastery state × constraints). This is what makes it genuinely adaptive rather than a static list with a progress bar.

## 14.5 The Evaluation Agent — the most important component

Failing here fails the product. Grounded in the [research consensus that question-specific rubrics dramatically improve LLM grading accuracy](https://dl.acm.org/doi/10.1145/3702652.3744220) and that [self-consistency plus selective human review raises reliability](https://www.mdpi.com/2504-4990/8/3/74).

**Pipeline:**

```
Submission
 → 1. Ingest & normalise    (repo clone / file parse / transcribe / image prep; PII scrub; size cap)
 → 2. Deterministic checks  (Tier 1 only: run tests, execute query, diff output, lint, check numerics)
 → 3. Rubric grading        (Opus 5, adaptive thinking, effort=high, structured output,
                             question-specific rubric, evidence quotation REQUIRED per criterion)
 → 4. Self-consistency      (Tier 2/3/4 only: 2nd pass at a different temperature-equivalent /
                             different prompt framing; disagreement > 1 band → flag)
 → 5. Verifier pass         (Sonnet 5: "does each score cite real evidence from the artefact?"
                             — catches hallucinated quotes, the #1 failure mode)
 → 6. Confidence assignment (from tier + deterministic-check agreement + self-consistency spread)
 → 7. Mastery update        (BKT; confidence weights the update magnitude)
 → 8. Human review queue    (if confidence < 0.5, or user disputed, or random 2% audit sample)
```

**Non-negotiable design rules:**
- **Every criterion score must quote the artefact.** No quote → the criterion is invalidated by the verifier. This single rule eliminates most hallucinated feedback.
- **Never grade without the rubric in the prompt.** [Research shows an LLM given only a problem and a solution grades markedly worse than one given the rubric.](https://dl.acm.org/doi/10.1145/3702652.3744220)
- **Deterministic checks always outrank the LLM.** If tests fail, the verdict is "fails" regardless of how good the prose looks.
- **The prompt must instruct: report every issue with confidence and severity; do not self-filter for importance.** Filtering happens in a separate deterministic step. Conservative-reporting instructions measurably depress recall on current models.
- **Log everything** to Langfuse: prompt version, model, rubric version, scores, confidence, dispute outcome. This log *is* the moat (§21).

## 14.6 Curriculum Validator — the anti-mediocrity gate

Runs on every generated curriculum before the learner sees it. Fails closed: a failed check regenerates that portion, and after 2 failures it falls back to the pack's canonical path.

| Check | Method | Fail action |
|---|---|---|
| **Prerequisite completeness** | Graph traversal: every module's skills have all `hard` prerequisites either earlier in the path or already mastered | Insert the missing prerequisite |
| **No hallucinated skills** | Every skill ID must exist in the pack graph. Free-text skills rejected outright | Regenerate |
| **No redundancy** | Pairwise embedding similarity between module objectives < 0.85 | Merge modules |
| **Length sanity** | Total hours within ±25% of (available hours × weeks to deadline) | Rescope; tell the user honestly |
| **Difficulty ramp** | Module difficulty is monotonic non-decreasing within a phase; no >2-level jumps | Reorder |
| **Nothing already mastered** | No module targets a skill with mastery > 0.8 | Drop it, and *show* the user it was dropped |
| **Resource freshness** | Every cited resource URL is HTTP-200 and, for fast-moving domains, published within 24 months | Replace via Resource Researcher |
| **Rubric coverage** | Every project module has a rubric with ≥4 criteria | Generate the rubric |
| **Factual spot-check** | Opus 5 adversarial pass: "identify anything factually wrong, outdated, or misleading" | Human review queue |

## 14.7 Tool calling, RAG, files, voice

- **Tools:** `web_search_20260209` + `web_fetch_20260209` (Resource Researcher, verification); code execution for Tier 1 grading; custom tools `fetch_repo`, `run_tests`, `query_skill_graph`, `lookup_learner_state`.
- **RAG:** pgvector in the same Postgres. Embed the vetted `Resource` corpus and the pack content only. **Do not RAG over the open web at request time** — that's what the Resource Researcher does offline, with verification. Retrieval is a scoped augmentation, not the architecture.
- **Files & images:** Anthropic Files API for documents; direct image blocks for Tier 3. Hard caps: 25MB, 50k tokens per artefact, with graceful truncation + a stated notice on the evaluation.
- **Voice (phase 2, not MVP):** Whisper-class transcription → existing text rubric pipeline; TTS for output. Deliberately deferred: it triples the cost of Tier 4 and Tier 4 is not where the initial revenue is.

## 14.8 Prompt versioning, observability, cost control

- **Prompts are versioned files in git**, loaded by `(name, version)`. Every `AgentRun` records the exact version. Never hot-edit a prompt in a database.
- **Evals before prompt changes.** A golden set of 50 submissions with expert-assigned scores per Curated pack. Any prompt change must not regress agreement (Cohen's κ vs. expert) — CI gate.
- **Observability:** Langfuse for traces/cost/latency per agent, per prompt version. PostHog for product events. Alert on p95 evaluation latency > 180s and on cost-per-active-user > $8/mo.
- **Cost control — five mechanisms, all required:**
  1. Model routing: Haiku 4.5 (classification, closed-item grading, routing) → Sonnet 5 (generation, tutoring) → Opus 5 (evaluation, validation, authoring) — **never default everything to Opus.**
  2. Aggressive prompt caching on the Learner Context Block (biggest single saving).
  3. Batch API (50% off) for all non-interactive work: weekly reflections, resource refresh, pack generation, SEO scoring.
  4. **Hard per-user monthly spend cap** enforced in application code, checked before every call. On breach: degrade to Sonnet, then queue, then notify. Never silently overspend.
  5. Free-tier work is served from **precomputed cache**, not live generation (§19).

## 14.9 Harness implementation

### 14.9.1 The orchestration flow

Every step is a **typed function with a validated input and output**, not a free-running agent. Multi-step chains run as Inngest durable functions, so a step that fails or a deploy that lands mid-run resumes rather than restarting.

```
user goal (free text)
  └─ [sync]  GoalAnalyzer          → GoalSpec
  └─ [sync]  PackMatcher           → packId | NEEDS_GENERATION      (code + embeddings)
  └─ [async] DiagnosticRunner      → ItemResponse[] → MasteryState[]  (code selects, LLM grades open items)
  └─ [async] ── Inngest: buildPath ──────────────────────────────────┐
                 SkillGraphProjector  → SkillProjection              │
                 CurriculumArchitect  → CurriculumDraft              │  durable,
                 CurriculumValidator  → ValidatorReport              │  step-resumable
                 (repair loop, max 2)                                │
                 ResourceResearcher   → Resource[]                   │
              ──────────────────────────────────────────────────────┘
  └─ [cron]  LearningPlanner        → PlannedSession                (PURE CODE, no LLM)
  └─ [sync]  LessonGenerator        → SessionBlock[]                (streamed)
  └─ [sync]  Tutor                  → message stream
  └─ [async] ── Inngest: evaluate ───────────────────────────────────┐
                 ArtifactIngestor    → NormalizedArtifact            │
                 DeterministicChecks → CheckResult[]   (Tier 1 only) │
                 RubricGrader        → GradedRubric                  │
                 ConsistencyPass     → GradedRubric   (Tier 2–4)     │
                 QuoteVerifier       → VerificationReport (CODE)     │
                 ConfidenceScorer    → Confidence      (CODE)        │
              ──────────────────────────────────────────────────────┘
  └─ [code]  MasteryUpdater         → MasteryUpdate[]               (BKT, no LLM)
  └─ [code]  LearningPlanner        → next PlannedSession
```

**Two things to notice.** The planner appears twice and contains no LLM call — the loop is closed by code, not by a model. And the quote verifier is **deterministic string matching**, not a judgment call: it checks that every quoted excerpt literally appears in the artefact. That is both cheaper and strictly more reliable than asking a model to check another model.

### 14.9.2 Step contracts

Zod schemas — they validate at runtime *and* compile to the JSON Schema the API's structured outputs need, so there is one definition per contract.

```ts
// ── 1. Goal intake ──────────────────────────────────────────────────
const GoalSpec = z.object({
  rawGoal:        z.string(),
  domain:         z.string(),                       // taxonomy node slug
  targetOutcome:  z.string(),                       // "ship a production ML API"
  outcomeType:    z.enum(['career','project','exam','personal','curiosity']),
  statedLevel:    z.enum(['none','beginner','intermediate','advanced']),
  weeklyHours:    z.number().min(0.5).max(40),
  deadline:       z.string().date().nullable(),
  motivation:     z.string(),
  constraints:    z.array(z.string()),              // "no maths", "mobile only"
  existingAssets: z.array(z.string()),              // equipment, prior work, tools
  clarity:        z.number().min(0).max(1),         // <0.6 ⇒ ask one more question
});

// ── 2. Diagnostic ───────────────────────────────────────────────────
const ItemGrade = z.object({
  itemId:      z.string(),
  correct:     z.boolean(),
  partial:     z.number().min(0).max(1),
  confidence:  z.number().min(0).max(1),
  misconception: z.string().nullable(),             // feeds the Misconception table
  evidence:    z.string(),                          // quote from the learner's answer
});

// ── 3. Skill projection ─────────────────────────────────────────────
const SkillProjection = z.object({
  requiredSkillIds: z.array(z.string()),
  optionalSkillIds: z.array(z.string()),
  excludedSkillIds: z.array(z.string()),
  exclusionReasons: z.record(z.string(), z.string()),  // shown to the user as "skipped because…"
  estimatedHours:   z.number(),
});

// ── 4. Curriculum ───────────────────────────────────────────────────
const CurriculumDraft = z.object({
  modules: z.array(z.object({
    order:            z.number(),
    title:            z.string(),
    targetSkillIds:   z.array(z.string()).min(1).max(3),
    estimatedHours:   z.number(),
    outputArtifact:   z.enum(['none','exercise','project','recording','document','media']),
    acceptanceCriteria: z.array(z.string()),
    rubricId:         z.string().nullable(),
  })).min(3).max(40),
  totalHours: z.number(),
  rationale:  z.string(),
});

const ValidatorReport = z.object({
  passed: z.boolean(),
  checks: z.array(z.object({
    name:     z.enum(['prereq_completeness','no_hallucinated_skills','no_redundancy',
                      'length_sanity','difficulty_ramp','no_already_mastered',
                      'resource_freshness','rubric_coverage','factual_spotcheck']),
    passed:   z.boolean(),
    severity: z.enum(['blocking','warning']),
    detail:   z.string(),
    repair:   z.unknown().nullable(),               // patch to apply
  })),
});

// ── 5. Session ──────────────────────────────────────────────────────
const SessionBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('explain'), skillId: z.string(), content: z.string(),
             estMinutes: z.number() }),
  z.object({ type: z.literal('check'),   skillId: z.string(), prompt: z.string(),
             expected: z.string(), isRetrieval: z.boolean() }),
  z.object({ type: z.literal('apply'),   skillId: z.string(), brief: z.string(),
             rubricId: z.string(), evidenceType: z.string() }),
  z.object({ type: z.literal('review'),  submissionId: z.string(), focus: z.string() }),
  z.object({ type: z.literal('reflect'), prompt: z.string() }),
]);
// invariant enforced in code, not prompt: sum(explain.estMinutes) <= 0.5 * sessionMinutes

// ── 6. Evaluation ───────────────────────────────────────────────────
const GradedRubric = z.object({
  criteria: z.array(z.object({
    criterionId: z.string(),
    band:        z.enum(['absent','developing','competent','strong']),
    score:       z.number().min(0).max(1),
    evidence:    z.string().min(1),                 // MUST appear verbatim in the artefact
    reasoning:   z.string(),
  })).min(4),
  overall:     z.number().min(0).max(1),
  strengths:   z.array(z.string()).max(3),
  gaps:        z.array(z.string()).max(3),
  nextActions: z.array(z.string()).max(3),
  provenBy:    z.array(z.string()),                 // canDo statements this establishes
});

const VerificationReport = z.object({          // produced by CODE, not a model
  quotesVerbatim:   z.boolean(),
  unverifiedQuotes: z.array(z.string()),
  bandSpread:       z.number(),                     // disagreement across passes
  deterministicAgreement: z.boolean().nullable(),   // Tier 1: does the verdict match test results
});

const MasteryUpdate = z.object({
  skillId: z.string(), prior: z.number(), posterior: z.number(),
  observationConfidence: z.number(), evidenceTier: z.number().min(1).max(5),
  evaluationId: z.string(), reason: z.string(),
});
```

**One rule the schemas enforce that a prompt cannot:** `evidence` is `.min(1)` and the verifier rejects any criterion whose evidence string is not found verbatim in the artefact. A hallucinated quote fails the step rather than reaching the learner.

### 14.9.3 Sync vs async, model routing, and cost per step

| Step | Model | Effort / thinking | Sync? | ~Tokens (in→out) | **Cost** | Frequency |
|---|---|---|---|---|---|---|
| GoalAnalyzer | Sonnet 5 | none | **Sync, streamed** | 12k → 2.4k | **$0.045** | once per goal |
| PackMatcher | — (embeddings) | — | Sync | — | **$0.0001** | once per goal |
| Diagnostic — closed items | — (code) | — | Sync | — | **$0** | 12/goal |
| Diagnostic — open items | Sonnet 5 | none | Sync | 1.5k → 0.4k ×6 | **$0.06** | once per goal |
| Diagnostic summary | Sonnet 5 | none | Async | 4k → 1.2k | **$0.03** | once per goal |
| SkillGraphProjector | Sonnet 5 | none | Async | 8k → 3k | **$0.07** | once per goal |
| CurriculumArchitect | Sonnet 5 | none | Async | 12k → 6k | **$0.13** | once per goal + re-plans |
| **CurriculumValidator** | **Opus 5** | adaptive, `high` | Async | 15k → 8k | **$0.28** | once per goal + re-plans |
| ResourceResearcher | Sonnet 5 + web search | none | Async, batched | — | **$0.08** | once per goal |
| **LearningPlanner** | **— (pure code)** | — | Cron | — | **$0** | nightly |
| LessonGenerator | Sonnet 5 | none | **Sync, streamed** | 6k (5k cached) → 3k | **$0.05** | per session |
| Tutor | Sonnet 5 | none | **Sync, streamed** | 10k (9k cached) → 0.5k ×10 | **$0.13** | per session |
| ArtifactIngestor | Haiku 4.5 | none | Async | 4k → 0.5k | **$0.007** | per submission |
| DeterministicChecks | — (code exec) | — | Async | — | **$0.005** | Tier 1 only |
| **RubricGrader** | **Opus 5** | adaptive, `high` | Async | 30k → 6k | **$0.30** | per submission |
| ConsistencyPass | Opus 5 | adaptive, `medium` | Async | 12k → 5k | **$0.19** | Tier 2–4 only |
| **QuoteVerifier** | **— (string match)** | — | Async | — | **$0** | per submission |
| Coherence check | Haiku 4.5 | none | Async | 5k → 0.5k | **$0.008** | per submission |
| MasteryUpdater | — (BKT code) | — | Sync | — | **$0** | per observation |
| ReflectionAgent | Sonnet 5 | none | **Batch API (−50%)** | 8k → 2k | **$0.01** | weekly |

**Rolls up to:** one-time onboarding **≈ $0.72**, per session **≈ $0.18**, per Tier 1 evaluation **≈ $0.32**, per Tier 2–4 evaluation **≈ $0.51**. These are the inputs to the §20.2 monthly figures (light $1.50 · average $4.80 · heavy $12.50) with ~30% overhead for retries, repairs and re-plans.

**Sync only where a human is waiting.** Everything a user watches happens synchronously and streams; everything else is Inngest. The two expensive Opus steps are both async by construction, which is what makes a 30–120s evaluation acceptable — the user gets a progress state and an email, not a spinner.

### 14.9.4 Caching

The single largest lever. Three layers:

1. **Prompt cache on the Learner Context Block** — ~1,200 tokens of frozen learner state at the head of every session and tutor prompt, behind a `cache_control` breakpoint. Cache reads are ~0.1× input, so 10 tutor turns cost roughly what 1.9 uncached turns would. **Verify with an assertion in staging that `cache_read_input_tokens > 0` on the second turn** — a silent cache miss triples the bill with no error and no log line.
2. **Content cache in Postgres** — generated lessons keyed by `(skillId, level, styleHash)` are reusable across learners. Expect a 40–60% hit rate once a pack has a few hundred users; the marginal cost of a cached lesson is a DB read.
3. **Precomputed free-tier output** — the top ~2,000 roadmap combinations generated once, validated, and served as a DB read (§19.2). This is the difference between ~$700/mo and ~$20/mo on the free tool.

Cache hygiene, all of which are silent failures if you get them wrong: frozen system prompt with no interpolation · tools sorted by name · `JSON.stringify` with sorted keys · **no timestamps or UUIDs anywhere in the prefix** · volatile content strictly after the last breakpoint.

### 14.9.5 Failure handling

| Failure | Response |
|---|---|
| Schema validation fails | Retry once with the validation error appended. Second failure → fall back to the pack's canonical output; never show the user a broken object. |
| Model returns `refusal` | Check `stop_reason` **before** reading content. Log, surface a plain message, route to human review. Never retry the identical prompt. |
| Rate limit / overload (429, 529) | SDK-level exponential backoff, `max_retries: 2`. Inngest re-queues the step beyond that. |
| Evaluation exceeds 180s | Continue in background; email on completion. The user is never blocked. |
| Verifier rejects the grading | Regrade once with the unverified quotes named. Second failure → route to human review, tell the user it's being checked. |
| Curriculum validator fails twice | Fall back to the pack's canonical path. Log for pack improvement. |
| Artefact too large | Truncate to 50k tokens at semantic boundaries and **state the truncation on the evaluation**. Never silently grade a fraction. |
| Inngest step fails mid-chain | Durable resume from the last completed step. Idempotency keys on every write. |

### 14.9.6 Prompt versioning and quality

- **Prompts are files in git**, loaded by `(name, version)`. Every `AgentRun` row records the exact version, model and cost. No hot-editing prompts in a database.
- **Golden eval set per Curated pack** — 50 hand-graded submissions with expert scores. CI computes Cohen's κ against expert bands and **fails the build below 0.6**. This is what makes a prompt or model change a measured decision instead of a leap.
- **Self-consistency check in CI** — the same submission graded twice must land within one band ≥85% of the time.
- **2% random audit** of production evaluations into the human review queue, plus 100% of disputes. Both feed the calibration corpus that §21 identifies as the actual moat.

### 14.9.7 Preventing runaway cost — six hard limits

Every one enforced in application code, not prompt instructions, and each with a concrete number:

| # | Limit | Value | Behaviour on breach |
|---|---|---|---|
| 1 | **Per-user monthly AI spend cap** | $15 (Pro), $1 (Free) | Degrade Opus → Sonnet, then queue, then notify. Checked *before* every call. |
| 2 | **Evaluation quota** | 10/mo Pro, 1/mo Free | Blocked with an upgrade prompt. This is the product's meter (§20.1). |
| 3 | **Artefact size** | 50k tokens / 25MB | Truncate at semantic boundaries, disclose on the evaluation |
| 4 | **Tutor turns per session** | 30 | Soft warning at 25; new session after 30 |
| 5 | **Agent step budget per chain** | 12 steps, `task_budget` on agentic calls | Inngest kills the run; falls back to canonical output |
| 6 | **Global daily spend ceiling** | set at ~3× trailing 7-day average | Free tier degrades to "we'll email it to you"; paid tier unaffected. This is the circuit breaker for an abuse spike or a prompt-loop bug. |

Plus: **alert at $8 cost-per-active-user** (the §25 dashboard metric), and a Langfuse cost-per-agent breakdown reviewed weekly. The failure mode you are guarding against is not a slow drift — it is a single bug or abuse event producing a 100× day.

---

# 15. Core Data Model

MVP-essential in **bold**; the rest is phase 2+.

### Learner & goals
- **`User`** — id, email, handle, locale, timezone, createdAt, plan, stripeCustomerId
- **`LearnerProfile`** — userId, weeklyHours, preferredSessionLength, learningStylePrefs (jsonb), constraints (jsonb), motivation, timezone, notificationPrefs
- **`LearningGoal`** — id, userId, packId, rawGoalText, goalSpec (jsonb), targetOutcome, deadline?, status, createdAt

### Domain & skills
- **`DomainPack`** — slug, name, maturity (curated/standard/generated), evalTier, version, qualityScore, reviewedBy, reviewedAt
- **`Skill`** — id, packId, slug, name, description, level, evalTier, estimatedHours, bktPriors (jsonb), canDoStatement, observableEvidence (jsonb)
- **`SkillDependency`** — fromSkillId, toSkillId, type (hard/soft), strength
- **`LearnerSkillMastery`** — userId, skillId, mastery (0–1), confidence, evidenceCount, lastObservedAt, lastPracticedAt, decayHalfLifeDays, **unique(userId, skillId)** — *the single most important table in the system*

### Curriculum & sessions
- **`Curriculum`** — id, goalId, version, generatedAt, validatorReport (jsonb), status
- **`CurriculumModule`** — curriculumId, order, title, targetSkillIds[], estimatedHours, outputArtifactType, rubricId?
- **`LearningPlan`** — userId, goalId, plannedFor (date), sessionSpec (jsonb), reason (text — *why this, today*), status
- **`LearningSession`** — id, userId, goalId, planId, startedAt, completedAt, blocks (jsonb), durationMinutes, selfReportedDifficulty
- `Lesson`, `Exercise` — cached generated content, keyed by (skillId, level, styleHash) for cross-user reuse

### Assessment & evidence
- **`AssessmentItem`** — packId, skillId, type, prompt, options?, answerKey?, difficulty (theta), discrimination, timesServed, timesCorrect — *calibration data lives here*
- **`Assessment`** / **`AssessmentResult`** — userId, goalId, itemId, response, correct, confidence, thetaEstimate, timeSpent
- **`Project`** — id, packId, slug, brief, rubricId, evidenceType, difficulty, isPublic (drives `/projects/*` SEO)
- **`Rubric`** — id, version, criteria (jsonb: name, description, bands[], weight), isPublic
- **`Submission`** — id, userId, projectId?, exerciseId?, artifactRefs[], submittedAt, status
- **`Artifact`** — id, submissionId, type (repo/file/image/audio/text/url), storageRef, sizeBytes, metadata
- **`Evaluation`** — id, submissionId, rubricId, rubricVersion, overallScore, confidence, evalTier, criterionResults (jsonb with evidence quotes), modelUsed, promptVersion, verifierPassed, humanReviewed, disputedAt?
- **`MasteryUpdate`** — evaluationId, skillId, priorMastery, posteriorMastery, delta, reason — *full audit trail; every mastery change is traceable to evidence*

### Interaction & ops
- **`Interaction`** — userId, sessionId, role, content, tokensIn, tokensOut, model, costCents, latencyMs
- **`AgentRun`** — id, agentName, promptVersion, model, input (jsonb), output (jsonb), status, costCents, latencyMs, error?
- **`Feedback`** — userId, targetType, targetId, rating, comment
- **`Progress`** — userId, goalId, week, hoursLogged, skillsAdvanced, artifactsProduced, retentionScore
- `Misconception` — userId, skillId, description, firstSeenAt, resolvedAt?  *(phase 2, high value)*
- `Resource` — url, title, type, domainAuthority, verifiedAt, skillIds[], qualityNote

### SEO entities
- **`SeoPage`** — slug, pageType, title, metaDescription, h1, sections (jsonb), qualityScore, **indexable (bool, default false)**, publishedAt, lastReviewedAt, reviewedBy, locale, canonicalOf?
- **`LearningTopic`** — slug, name, skillIds[], relatedTopicIds[], searchIntent, estimatedHours
- **`SearchIntent`** — keyword, volumeBand, difficultyBand, serpType, targetPageId, verifiedAt
- **`Faq`** — pageId, question, answer, order
- **`InternalLink`** — fromPageId, toPageId, linkType, anchorText
- **`PublicLearningPath`** — userId, goalId, slug, visibility (private/unlisted/public), gatePassed (bool), viewCount, redactions (jsonb)
- `Career`, `Roadmap` — *phase 2*

**Which are DB-driven vs. dynamic:** everything indexable is **DB-driven and statically rendered** — SEO pages must be deterministic, diffable, reviewable and cacheable. Only authenticated, personalized views are generated dynamically. Never generate indexable content at request time.

---

# 16. The Learning Engine

## 16.1 "What should the learner do next?" — v1 algorithm

Runs nightly per active goal (and on-demand after any mastery update). **Pure deterministic code.** ~200 lines.

**Step 1 — Eligibility filter.** From the goal's skill subgraph, keep skills where:
- every `hard` prerequisite has mastery ≥ 0.7, AND
- own mastery < 0.85, AND
- the skill is on a path to a goal-required skill

**Step 2 — Score each eligible skill:**

```
score(s) =  1.6 × goalCriticality(s)          // shortest-path centrality to goal skills
          + 1.2 × masteryGap(s)               // (0.85 - mastery), clipped at 0
          + 1.0 × prereqReadiness(s)          // mean mastery of soft prereqs
          + 1.4 × retentionUrgency(s)         // decay-driven; see 16.3
          + 0.7 × momentum(s)                 // continuity with the last 2 sessions
          + 0.5 × interleavingBonus(s)        // rewards switching skill *area*, not topic
          - 1.8 × frustrationRisk(s)          // recent failures on s or its prereqs
          - 0.9 × timeFit(s)                  // |estimatedBlockTime - availableTime| / available
          - 2.5 × recentlyFailedTwice(s)      // hard damper: back off, don't grind
```

**Step 3 — Deadline override.** If a deadline exists and projected completion > deadline, multiply `goalCriticality` by 2.0 and drop all non-essential skills from eligibility. Then *tell the user* the plan was compressed and what was cut.

**Step 4 — Compose the session** to fill available minutes:
- Always open with **2–4 retrieval items** from the spaced-repetition queue (5–8 min). Non-negotiable.
- Then the top-scoring skill's next activity.
- Every **4th session** is an `apply` session producing a gradeable artefact. **Hard rule, enforced in code** — this is what makes mastery move.
- Cap `explain` blocks at 50% of session duration.

**Step 5 — Explain the choice.** A one-sentence, template-filled reason shown on `/today`: *"You've got the syntax down but two of your last three joins had the wrong grain — today is 25 minutes on join grain, then a real query to grade."* **Template-filled from the score components, not LLM-generated** — it must be truthful, and it must be free.

## 16.2 Mastery model — BKT with decay

[Bayesian Knowledge Tracing still outperforms LLM-only approaches in production.](https://www.forasoft.com/blog/article/ai-tutors-adaptive-learning-2026) Four parameters per skill, expert-seeded, refit from your own data once you have ~500 observations per skill.

```
On observation (correct: bool, confidence: c ∈ [0,1]):
  pCorrect  = p·(1 − pSlip) + (1 − p)·pGuess
  posterior = correct ? p·(1 − pSlip)/pCorrect
                      : p·pSlip/(1 − pCorrect)
  p'        = posterior + (1 − posterior)·pLearn
  // Blend by evidence confidence — a Tier 3 verdict moves mastery less than a Tier 1 one
  p_new     = p + c·(p' − p)
```

**Decay:** `mastery_effective = mastery × 0.5^(daysSinceLastSuccess / halfLife)`, where `halfLife` starts at 7 days and **doubles on each successful spaced retrieval** (capped at 180). This is the expanding-interval mechanism, and it is what generates `retentionUrgency` in the planner — spaced repetition falls out of the model rather than being bolted on.

Adaptive diagnostic uses the same machinery: pick the item whose difficulty is closest to the current mastery estimate (maximum information), stop when the confidence interval is narrower than 0.15 or after 12 items. Typically converges in 8–10.

## 16.3 Deterministic vs. LLM — the tradeoff, explicitly

| | Deterministic scoring | LLM planner |
|---|---|---|
| Cost | ~$0 | $0.01–0.05 per decision |
| Latency | <10ms | 2–15s |
| Consistency | Perfect | Varies run to run |
| Debuggable | Fully — inspect the score components | Barely |
| Testable | Unit tests | Vibes + evals |
| Improves with data | Yes — refit weights | Only via prompt fiddling |
| Handles novelty | Poorly | Well |

**Verdict: deterministic, decisively.** The planner runs thousands of times a day, must be identical on reload, and must be explainable to the user. Use the LLM where novelty actually appears: interpreting a messy artefact, generating content, handling an unanticipated learner question.

**One exception:** when the deterministic planner's top three scores are within 5% of each other, ask Sonnet 5 to break the tie with the learner context. Rare, cheap, and adds genuine judgement exactly where the code has none.

## 16.4 Learning-science principles → concrete product behaviour

No buzzwords without a mechanism.

| Principle | Concrete implementation | Where it appears |
|---|---|---|
| **Retrieval practice** | Every session opens with 2–4 recall items from prior skills, before any new content | `/session` block 1, always |
| **Spaced repetition** | Expanding-interval half-life in the mastery decay model drives `retentionUrgency` | Planner scoring; "overdue" on `/today` |
| **Active recall over recognition** | Free-text and produce-an-answer items outnumber MCQ ≥2:1 in every item bank | Pack build-time validation rule |
| **Deliberate practice** | Every activity targets one specific weak sub-skill, not the topic broadly; immediate specific feedback | Planner picks skills, not topics |
| **Interleaving** | `interleavingBonus` rewards switching skill *area* between sessions; retrieval items always drawn from a different area than the new content | Planner scoring |
| **Scaffolding & fading** | Exercise `supportLevel` (worked example → partial → independent) decreases automatically as mastery rises | Practice Generator input |
| **Project-based learning** | Every 4th session produces a gradeable artefact; every module ends in an output | Hard rule in session composition |
| **Desirable difficulty** | Target ~75–85% success rate; if a learner is above 90% for 3 sessions, jump difficulty; below 55%, back off | Planner `frustrationRisk` + difficulty targeting |
| **Immediate specific feedback** | Tier 1 grading returns in seconds; all tiers quote the artefact | Evaluation Agent |
| **Metacognition** | Weekly reflection prompt + confidence self-rating *before* each check, compared to actual result | `/progress`, calibration display |
| **Generation effect** | "Explain this back in your own words" blocks, graded loosely for concept coverage | Session block type |

**Rejected on purpose:** learning styles (visual/auditory/kinesthetic) as an adaptation axis — no credible evidence. Capture the *preference* for UX comfort; never let it drive pedagogy.

---

# 17. MVP Definition

## 17.1 The hypothesis under test

> **Will people repeatedly use — and pay for — an adaptive learning system because it grades their real work and shows them evidence-backed progress toward a goal?**

## 17.2 MVP scope

**MUST HAVE**
- Goal interview (≤6 turns) with taxonomy classification
- 12 **Curated** Domain Packs + ~60 Standard + on-demand Generated (so any goal works)
- Adaptive diagnostic, 8–12 minutes, from the pack item bank
- Skill graph + generated curriculum + **Curriculum Validator**
- `/today` daily session with an honest one-line reason
- Session engine: `explain` / `check` / `apply` / `review` blocks + tutor chat
- **Four domain workspaces** — Text, Code, Query & Sheet, Media (§7.3); artefact submission via repo URL, file, paste or image
- **Evaluation Agent** with public rubrics, evidence quotes, confidence bands, Tier 1 code execution
- **BKT mastery model with decay** + Mastery Map showing "what I can do" with evidence
- Deterministic planner + spaced retrieval queue
- Email: daily nudge, weekly digest, evaluation-ready
- **Free public Skill Check** (works without signup) + Roadmap Generator
- **50 SEO pages** + full technical SEO (§13)
- Auth, Stripe/Polar billing, per-user AI spend cap
- PostHog + Langfuse + GSC instrumentation from day one

**SHOULD HAVE (weeks 5–8)**
- Proof Pages with the quality gate
- Dispute → re-evaluation flow
- Streaks and commitment tracking
- The local-language beachhead

**LATER**
- Voice tutoring & Tier 4 roleplay · multi-goal · teams/B2B · mobile app · community · certificates · pack marketplace

**DON'T BUILD**
- ❌ A content library — you are not competing on content
- ❌ Your own code-execution sandbox in MVP — GitHub URL + Anthropic code execution covers Tier 1
- ❌ A general chatbot — the tutor is scoped to the session
- ❌ Gamification beyond a streak — earn the right first
- ❌ Timeframe/duration combinatorial SEO pages — §12
- ❌ Mobile app · integrations · social feed · LMS features · certificates

## 17.3 Kill criteria — decide these now, not later

You chose to build first and validate after. Then the validation must be pre-committed. Measure at **day 60 post-launch, with ≥100 signups:**

| Metric | Kill | Pivot | Continue |
|---|---|---|---|
| D7 retention (signup → active) | <15% | 15–30% | >30% |
| **D30 retention** | **<8%** | 8–20% | **>20%** |
| Submissions per active user, week 4 | <0.5 | 0.5–2 | >2 |
| Free → paid conversion | <2% | 2–5% | >5% |
| "Was this evaluation useful?" | <60% yes | 60–80% | >80% |
| Month-2 subscription retention | <60% | 60–80% | >80% |

Baseline for calibration: [AI apps convert trials at ~8.5% but retain only ~6.1% monthly](https://www.creem.io/blog/ai-app-retention-paradox-churn-2026). **Beating the AI-app retention baseline is the whole game.** If D30 is under 8% at day 60, the evaluation thesis is wrong and no amount of SEO will save it.

---

# 18. Technical Stack

## 18.1 MVP architecture — deliberately boring

| Layer | Choice | Why |
|---|---|---|
| **Frontend + backend** | **Next.js 15 (App Router), TypeScript, React Server Components** | One codebase serving both the crawlable marketing site and the interactive SaaS (§13.1). Nothing else does this as cleanly. |
| **Styling / UI** | **Tailwind (token-restricted) + Radix primitives via shadcn, fully restyled** + `motion` + self-hosted Instrument Sans | Our own design language — full spec in **§8.5**. Apple's *principles* (content over chrome, progressive disclosure, the five-item density rule), not their visual language. shadcn supplies accessible Radix code only; every default class is replaced by our tokens, and Tailwind's default palette/spacing/font config is deleted so the design can't drift. |
| **Database** | **Postgres (Neon)** + **Drizzle ORM** + **pgvector** | Serverless-friendly, branching for preview envs, vector search with no extra infra. Drizzle over Prisma for smaller cold starts. |
| **Auth** | **Better Auth** (self-hosted, Postgres-backed) | No per-MAU cost, owns its tables, TS-native. *Clerk if you value week-1 speed over the ~$100/mo at scale.* |
| **Background jobs** | **Inngest** | Durable multi-step functions with retries — exactly the shape of the evaluation and curriculum pipelines. Steps survive deploys. No queue infra to run. |
| **AI** | **Anthropic SDK directly** (`@anthropic-ai/sdk`). **No LangChain.** | Routing: Haiku 4.5 → Sonnet 5 → Opus 5. Frameworks add indirection and obscure the caching behaviour you depend on. |
| **AI observability** | **Langfuse** (cloud) | Traces, cost per agent, prompt versions, eval scoring |
| **Object storage** | Cloudflare R2 | S3-compatible, zero egress fees — matters for artefacts |
| **Payments** | **Polar** or **Paddle** (Merchant of Record) | You're EU-based; MoR handles global VAT/sales tax. Do not hand-roll VAT with raw Stripe. |
| **Email** | Resend + React Email | |
| **Analytics** | **PostHog** (events, funnels, replay, flags) + GA4 + GSC + Bing WMT | |
| **Error tracking** | Sentry | |
| **Hosting** | Vercel | ISR + edge + preview deploys; the marketing/app split works natively |
| **Rate limiting** | Upstash Redis | Free-tool abuse control (§19) |

**Nine managed services, zero containers, zero Kubernetes, one deployable.** A solo developer can operate this.

**Code execution for Tier 1 grading:** MVP uses GitHub URL + Anthropic's `code_execution` tool. Do not build a sandbox. Phase 2, if volume justifies: E2B or Daytona.

## 18.2 Post-PMF architecture

Change only when a specific metric forces it:

| Trigger | Change |
|---|---|
| Evaluation p95 > 3 min, or code execution needs real isolation | Extract an evaluation worker (Fly.io / Railway container) with E2B sandboxes |
| >2k concurrent learners | Postgres read replica; move `Interaction` to a partitioned table or ClickHouse |
| AI spend > $5k/mo | Fine-tuned or distilled classifier for closed-item grading; expand Batch API usage; semantic caching of common lessons |
| SEO corpus > 2k pages | Move page generation to a build-time pipeline with an approval workflow; consider a dedicated CDN cache layer |
| Voice launches | Realtime transcription service; WebRTC; separate scaling profile |
| Team/B2B demand | Org/seat model, SSO, admin dashboards |

**Still no Kubernetes. Still no microservices.** A modular monolith with two extracted workers will carry this to eight figures.

---

# 19. Free Tool Strategy

## 19.1 What the free tool should be

**Not a roadmap generator. A Skill Check.**

A roadmap generator gives away exactly the thing that's commoditized, costs you AI spend per use, and produces output the user can get free from ChatGPT. A **Skill Check** gives away a *diagnosis* — which is more useful, cheaper to serve, more novel, and creates the exact emotional state that converts: *"I'm weaker at this than I thought, and now I know precisely where."*

Ship both, but make the Check primary:

| Tool | Free? | Limit | Cost per use | Purpose |
|---|---|---|---|---|
| **Skill Check** `/check/{skill}` | ✅ Fully, no signup | 3/day per IP | **~$0.01** (item bank is precomputed; only free-text grading is LLM, on Haiku) | Primary conversion surface |
| **Roadmap Generator** `/tools/learning-roadmap-generator` | ✅ | 1/day anon, 5/day with email | **~$0.00–0.07** — see below | Link magnet, SEO |
| **Learning Time Calculator** | ✅ | Unlimited | **$0** (pure function over pack data) | Link magnet |
| **Skill Gap Analyzer** | Email required | 3/mo | ~$0.03 | Mid-funnel |

## 19.2 Cost & abuse control — the critical design decision

**Precompute, don't generate.** Roadmaps for the top ~2,000 (goal × level × weekly-hours) combinations are generated **once**, validated, human-spot-checked, and stored in Postgres. A request that matches a stored combination is a **database read: zero marginal AI cost, ~50ms, and fully reviewable**. Only genuinely novel goals hit live generation, behind an email gate.

This is worth being explicit about: naive live generation at 10k roadmaps/month costs ~$700/mo and is trivially abusable. Precomputed cache-first costs ~$20/mo and produces *better* output, because every cached roadmap has passed the quality gate.

**Abuse controls:** Upstash IP rate limit · Cloudflare Turnstile on the novel-generation path · email verification for >1 novel generation/day · hard global daily spend cap on the free tier that degrades to "we'll email it to you" · block the obvious datacenter ASNs.

## 19.3 Conversion funnel

```
Organic search → /check/python  →  Take the check (no signup)  →  Result: level + gaps
        ↓                                                                 ↓
   Read the page                                       "Want a plan built on THIS result,
   (useful either way)                                  and someone to grade your work?"
                                                                          ↓
                                             Signup (result is preserved and carried in)
                                                                          ↓
                                          Full diagnostic → path → first session → FIRST GRADED SUBMISSION
                                                                          ↓
                                          ← ACTIVATION. Everything before this is preamble.
```

**The single activation metric: first graded submission within 7 days of signup.** Optimise relentlessly for it. Make the first project small enough to finish in one sitting.

**Sharing value:** every check result gets a shareable card ("I scored Intermediate on SQL — where are you?"). Genuinely social, zero privacy risk, natural for LinkedIn/X.

---

# 20. Business Model & Unit Economics

## 20.1 Pricing

**Launch with one paid tier.** Two tiers doubles the decision friction and the support surface for a solo founder.

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Unlimited Skill Checks · 1 goal · roadmap + full diagnostic · 3 sessions/week · **1 evaluation/month** |
| **Pro** | **$25/mo** or **$190/yr** (37% off) | 1 active goal · unlimited sessions · **10 evaluations/month** · full mastery ledger · Proof Page · priority evaluation |
| *Later (post-PMF)* | *$49/mo* | *3 goals · unlimited evaluations · voice · human review on request* |

**Rationale:** above roadmap.sh ($10 — you do far more), below boot.dev ($59 — you're broader but less deep), at Duolingo Max's psychological band ($30). The **evaluation quota is the meter** — it's the expensive thing, the valuable thing, and the honest thing to charge for. Annual is pushed hard: it fixes the AI-app churn problem by construction.

**Rejected:** freemium with unlimited evaluations (margin death) · pure usage-based (kills the habit you're trying to build) · under $15 (attracts the churning casual segment and can't cover heavy users) · B2B at launch (different product, different sale, wrong time).

## 20.2 AI cost per active learner per month

Model prices: Opus 5 $5/$25 per MTok · Sonnet 5 $3/$15 ($2/$10 intro to 2026-08-31) · Haiku 4.5 $1/$5. Cache reads ≈0.1× input. Batch API 50% off.

**Per-operation costs (with caching applied):**

| Operation | Model | Cost |
|---|---|---|
| Goal interview (one-off) | Sonnet 5 | $0.04 |
| Adaptive diagnostic (one-off) | Haiku + Sonnet | $0.12 |
| Curriculum generation + validation (one-off, and on major re-plan) | Sonnet + Opus | $0.55 |
| **Learning session** (content + ~15 tutor turns, cached prefix) | Sonnet 5 | **$0.17** |
| **Evaluation — Tier 1** (repo, exec, rubric, verifier) | Opus 5 + Sonnet 5 | **$0.45** |
| **Evaluation — Tier 2/3** (doc/image, 2-pass + verifier) | Opus 5 + Sonnet 5 | **$0.38** |
| Nightly planner | none (code) | $0.00 |
| Weekly reflection | Sonnet 5, Batch | $0.01 |

**Monthly cost by usage profile:**

| Profile | Sessions/mo | Evaluations/mo | AI cost | +30% overhead | **Total** |
|---|---|---|---|---|---|
| **Light** | 4 | 1 | $1.13 | $0.34 | **~$1.50** |
| **Average** | 12 | 4 | $3.68 | $1.10 | **~$4.80** |
| **Heavy** (at the 10-eval cap) | 30 | 10 | $9.60 | $2.88 | **~$12.50** |

## 20.3 Gross margin

At **$25/mo**, minus ~4% MoR fees ($1.00) → **$24.00 net**:

| Profile | AI cost | Gross margin | % |
|---|---|---|---|
| Light | $1.50 | $22.50 | **94%** |
| **Average** | **$4.80** | **$19.20** | **80%** |
| Heavy | $12.50 | $11.50 | **48%** |
| **Blended** (20/60/20 mix) | ~$5.60 | ~$18.40 | **~77%** |

**77% blended gross margin.** Healthy for SaaS, and the 10-evaluation cap makes the worst case survivable. Free-tier drag: ~$0.30/free-user/month with precomputed roadmaps — at a 4% conversion rate that's ~$7 of free cost per paying user per month, still leaving ~50% net-of-free margin. Acceptable, and it improves as cache hit rates rise.

**Fixed costs at MVP scale:** ~$150–250/mo (Vercel $20 · Neon $25 · Inngest $20 · PostHog $0–50 · Langfuse $30 · Resend $20 · Upstash $10 · Sentry $26 · domain/misc). **Break-even at roughly 15–20 paying users.**

---

# 21. Defensibility

Be sceptical. Most claimed moats here are not moats.

| Candidate | Real? | Honest assessment |
|---|---|---|
| **Rubric + item bank with calibration data** | ✅✅ **Strongest** | Knowing *which* items discriminate skill level, *which* rubric criteria predict downstream success, and *where* the model disagrees with experts — this requires volume, cannot be scraped, and improves monotonically. A competitor can copy your rubrics; they cannot copy which criteria are *predictive*. |
| **Curriculum performance data** | ✅ **Real, year 2+** | "Learners with profile P who did sequence S reached mastery 40% faster." Needs ~10k completed paths. Genuinely compounding. |
| **Evaluation quality via calibration loop** | ✅ **Real** | Every dispute, every human review, every 2% audit sample is a labelled training example. After a year this is a proprietary eval set that lets you ship prompt/model changes safely while competitors guess. |
| **Learner interaction data** | ⚠️ Weak alone | Raw logs are worthless. Only valuable *as* the input to the two above. |
| **The mastery ledger / outcome record** | ⚠️ Becomes real if adopted | If learners cite it and anyone external trusts it, switching cost becomes very high. Three-year bet, low probability, enormous payoff. Build the substrate; don't count on it. |
| **SEO authority** | ⚠️ **Rentable, not ownable** | Real for 2–3 years, worth building. But an algorithm update or a well-funded competitor can take it. Never the primary moat. |
| **The skill graph** | ❌ **Not a moat** | A competitor generates a comparable one in a day with Opus. Do not tell investors this is your moat. |
| **Personalization / adaptive algorithm** | ❌ **Not a moat** | BKT is from the 1990s. The *fitted parameters* are the asset, not the algorithm. |
| **Prompts and AI architecture** | ❌ **Zero** | Copyable in an afternoon. |
| **Community / UGC paths** | ❌ Unlikely | Requires scale you won't have, and it's not your comparative advantage as a solo builder. |
| **Brand** | ⚠️ Slow | Real over 3+ years if the evaluations are consistently trusted. |

**Year 1 moat:** speed, focus, and the fact that everyone else is building the commoditized layer.
**Year 3 moat, if it works:** the calibration corpus — *"our evaluations are trusted because we have 200,000 graded artefacts with expert-verified outcomes, and we can prove our grades predict real-world capability."* That is the only sentence in this document that a well-funded competitor cannot say by shipping faster.

**Act on this now:** log every evaluation with its full context, every dispute with its resolution, every item response with its outcome — from day one, even before you can use the data. The corpus you fail to collect in year one is the moat you don't have in year three.

---

# 22. Growth Loops & Acquisition

## 22.1 Channel roles

| Channel | Role | Timeline | Effort | Verdict |
|---|---|---|---|---|
| **SEO (tools + long-tail)** | **Primary long-term engine** | 6–18 months | High, front-loaded | **Yes — but it will not carry months 0–9. Plan accordingly.** |
| **Free tools as link magnets** | Backlink + brand acquisition | 3–12 months | Medium | **Yes** — the Skill Check is the single most linkable asset you can build |
| **Communities (Reddit, Discord, HN, Indie Hackers, Dev.to, r/learnprogramming, r/datascience)** | **Primary months 0–6** | Immediate | High, manual | **Yes.** Participate genuinely for weeks before mentioning the product. This is where your first 200 users come from. |
| **Shareable Proof Pages / check results** | Compounding referral | 3+ months | Low (build once) | **Yes** — the strongest organic loop available to you |
| **Product Hunt** | One-day spike + backlinks | Launch day | Medium | **Yes, once.** Expect ~500–2,000 visits and mostly non-ICP signups. Value is the DR-90 backlink and social proof, not users. |
| **X / LinkedIn build-in-public** | Distribution while SEO matures | Immediate | Medium, ongoing | **Yes** — post real numbers, real evaluation examples, real failures |
| **YouTube / TikTok** | Long-term brand | 6+ months | Very high | **No** for a solo founder. The opportunity cost is your entire product. |
| **Paid search** | Validation only | Immediate | Low | **€300 test only** (§22.3). CAC on generic learning terms will exceed LTV. |
| **Paid social** | — | — | — | **No.** Learning intent is search-driven, not feed-driven. |

## 22.2 The two growth loops

**Loop A — Search → Tool → Product → Proof → Search** *(primary)*

```
Search "test my SQL level"  →  /check/sql (useful, free, no signup)
      ↓
Result reveals a real gap  →  "Get a plan built on this + get your work graded"  →  Signup
      ↓
Diagnostic → path → sessions → FIRST GRADED SUBMISSION  →  activated
      ↓
Mastery ledger accumulates evidence  →  learner publishes a Proof Page (gated on 3+ artefacts)
      ↓
Shared on LinkedIn/X/portfolio + indexed  →  backlinks + referral traffic  →  domain authority rises
      ↓
Existing /check and /projects pages rank higher  →  more search traffic  ⟲
```

**Viability:** high. Each stage is independently useful; nothing depends on virality. The Proof Page → backlink step is genuinely compounding because the pages are unique user-generated content, which is the only page type that can safely scale to thousands without content-farm exposure.

**Loop B — Learner goal → indexed page → new learners** *(your original hypothesis)*

Your brief proposed: user goal → AI generates a public page → gets indexed → others find it. **This version does not work.** Auto-publishing generated pages per user goal is precisely the scaled-content-abuse pattern that lost sites 60–90% of traffic.

**The version that does work:** a *learner-produced* page — real artefacts, real rubric scores, real timeline, real reflections — is genuinely unique content. So Loop B becomes: **user goal → learner does the work → evidence accumulates → learner opts in → quality gate → indexed.** Gated on ≥3 evaluated artefacts + ≥1 completed project + a non-trivial written reflection. Perhaps 5% of users will qualify and opt in. At 1,000 paying users that's ~50 genuinely excellent indexed pages a year. Small, but every one is safe, unique, and linked from the learner's own network.

## 22.3 First €1,000 of marketing spend

| Amount | Item | Rationale |
|---|---|---|
| **€0** | Community participation, build-in-public, Product Hunt | Your time, not your money. Highest-ROI channel at this stage. |
| **€300** | Ahrefs or Semrush, 1 month | Do the §2.6 keyword verification properly, export everything, cancel. Guessing at keywords is the most expensive mistake available. |
| **€300** | Google Ads exact-match test | 3 weeks on 15 terms from §10 (`python skill test`, `test my sql level`, `how long to learn machine learning`, …). **The goal is not users — it's measuring which intents convert to a completed Skill Check.** Then prioritise those pages for SEO. This turns a €300 spend into a content roadmap. |
| **€200** | Design: logo, OG cards, Proof Page template | Proof Pages are shared publicly. If they look amateurish, the loop dies. |
| **€150** | 15 user interviews × €10 gift card | Post-launch, weeks 5–8. **The highest-information €150 you will spend.** |
| **€50** | Domain, misc | |

**Do not spend on:** display ads, sponsorships, influencers, cold email, guest-post link buying, or an SEO agency. All negative-ROI at this stage.

---

# 23. Roadmap

Every item classified **MUST / SHOULD / LATER / DON'T**.

### Phase 0 — Foundations (week 0, ~4 days)
Since you chose to build first, Phase 0 is the minimum that prevents building the wrong thing.

- **MUST** — Keyword verification (§2.6). Output: a validated list of the 50 pages, with the losers dropped.
- **MUST** — Sign up for and *use* roadmap.sh Pro, Ulern, Oboe for a full week. Take notes on what you can't stand. This is competitor research you cannot get from a webpage.
- **MUST** — Hand-write **one complete Curated pack** (SQL — small graph, Tier 1, high demand) end to end: 25 skills, dependency graph, 40 diagnostic items, 4 project briefs with full rubrics. **Do this by hand before writing any code.** It defines every schema in the system, and it will take you a day and save you three weeks.
- **MUST** — Grade 5 real submissions by hand against your own rubric, then have Opus 5 grade them, then compare. This is your first calibration data point and it tells you whether the core thesis is even technically feasible.
- **SHOULD** — Pick the beachhead language and register the domain.
- **DON'T** — Design mockups, brand work, pitch decks, investor conversations.

### Phase 1 — MVP (weeks 1–4)
Everything in §17.2 MUST HAVE. Detailed in §24 and §27.

### Phase 2 — Toward PMF (weeks 5–16)
- **MUST** — 15 user interviews; instrument and act on the funnel
- **MUST** — Proof Pages + quality gate; dispute/re-evaluation flow
- **MUST** — Expand to 12 Curated packs (one every 10 days)
- **MUST** — SEO pages 51–120; publish the first proprietary-data page ("what 500 submissions taught us about where people fail at SQL")
- **MUST** — Refit BKT parameters from real data; refit planner weights
- **SHOULD** — Streaks/commitments; the local-language beachhead; Product Hunt launch
- **SHOULD** — Annual plan push; win-back and dunning emails
- **LATER** — Voice; multi-goal; teams
- **DON'T** — Mobile app; community; certificates; integrations

### Phase 3 — Scale (months 5–12)
- Pack marketplace (expert-authored packs, revenue share) — the horizontal ambition's real endgame
- Human-expert review as a premium add-on (defensible, high margin, closes the Tier 3/4 confidence gap)
- B2B: teams, L&D dashboards, skill-gap analysis for orgs — **highest-revenue path, but only after consumer PMF**
- Programmatic SEO scaled to the templates that proved out, with the quality gate enforced
- Public calibration report: *"here's how our grades compare to expert graders"* — a genuinely novel trust asset and a superb PR/link hook

---

# 24. Engineering Implementation Plan

Ordered by dependency. Each epic: why it exists → inputs → outputs → dependencies → acceptance criteria.

## Build status — where the implementation actually is

`IMPLEMENTATION.md` carries the per-pass record; this is the map. **Read this
before picking the next thing up.**

| Epic | State | Where it lives |
|---|---|---|
| **E1** Foundation | ✅ Done | `src/db/`, `src/lib/inngest/`, `src/lib/auth.ts` |
| **E2** Domain Pack system | ✅ Done | `src/lib/packs/` — loader, validator, seeder, **and `read.ts`** |
| **E3** Goal intake | ✅ Done | `src/lib/goals/analyzer.ts`, `match.ts`, `/start` — the conversation, not the form |
| **E4** Adaptive diagnostic | ✅ Done | `src/lib/engine/diagnostic.ts`, `/check/{topic}` |
| **E5** Mastery model + planner | ✅ Done | `src/lib/engine/` — BKT, scoring, planner, composer |
| **E6** Curriculum + validator | ✅ Done | `src/lib/curriculum/` |
| **E7** Session engine + tutor | ✅ Done | `src/lib/session/`, `/session/{id}` |
| **E7.5** Generated packs | ✅ Done — *not in the original plan* | `src/lib/packs/generate/`, `/start/building`, `/admin/packs` |
| **E8** Submission + Evaluation | 🟡 **Built, not accepted** | `src/lib/evaluation/`, `src/lib/submissions/`, `/submission/{id}` — loop verified end to end; κ and band-stability criteria still unmet |
| **E9** Mastery map + progress | ⬜ Not started | — |
| **E10** SEO infrastructure | 🟡 Partial | `sitemap.ts`, `robots.ts`, JSON-LD, `/learn`, `/projects` exist |
| **E11** Free tools + roadmap cache | 🟡 Partial | the Skill Check ships; the rest does not |
| **E12** Content production | ⬜ Not started | 3 curated packs of the 12 |
| **E13** Billing, emails, launch | 🟡 Partial | emails ship; billing does not |

**E8's code is done and the loop has been watched run** — a real submission from
the textarea through Inngest to a marked result, at $0.108 and about 45 seconds
(IMPLEMENTATION.md pass 19). What is *not* done is accepting it: κ ≥ 0.6 against
a hand-graded set, and two runs landing within one band ≥85% of the time. Both
need the Phase-0 corpus in §23, which lists "grade 5 real submissions by hand" as
a MUST that was never done. **That corpus is the next piece of work on E8, and it
is human work rather than code.**

After it, **E9 — the mastery map — is the next epic to build.**

## E7.5 — Generated packs (built between E7 and E8)

Not an epic in the original plan, because §7.1 described the Generated tier as a
property of the pack system rather than as work. It turned out to be the largest
single piece after the engine, and E3's acceptance criterion ("a goal with no
matching pack triggers Generated-pack creation") could not be met without it.

**What it added, in dependency order:**

1. `packs/read.ts` — reading a pack back out of the database. Nothing had ever
   done this; `seedPack` had been write-only since pass 1. Without it a generated
   pack has nowhere to live, because the production filesystem is read-only.
2. `content/resolve.ts` — disk first, database second, and **only in `(app)`**.
   Marketing stays synchronous and disk-backed because it is the SEO surface.
3. `packs/generate/` — three calls: skill graph (deep tier), item bank
   (standard, batched by area), rubrics and projects (standard).
4. `goals/analyzer.ts` — §8 screen 3's conversation, replacing the form.
5. `pack_build` + the Inngest `pack/generate.requested` function — authoring
   takes about three minutes and cannot happen in a request.
6. `admin/generated.ts` — the review queue and §7.1's promotion gate.

**Numbers to plan against, measured rather than estimated:**

| | |
|---|---|
| Cost per pack | **$0.61** (graph $0.14 · items ~$0.27 · rubrics $0.19) |
| Wall time | **~190–200s**, of which the rubric author is ~120s |
| Typical output | 14 skills · ~55 items · 3–5 rubrics · 3–5 projects |
| Shared by | everyone who asks for that subject — the cost is per *subject* |

**Rules enforced in code, which any later change must not quietly undo:**

- A generated pack **may never claim §7.2 tier 1**. Tier 1 licenses "Verified:
  this works" and is earned by executing the artefact; a pack with no evaluator
  and no human review cannot. `MAX_GENERATED_TIER` in `generate/derive.ts` caps
  it per workspace.
- The skill graph is **acyclic by construction** — prerequisites may only name
  skills listed earlier, and a forward reference is dropped.
- Slugs, BKT priors, evaluation tiers and rubric weights are **computed, never
  asked for**. They are what `validatePack` blocks on and what models are worst
  at.
- A later call never quotes a name back. Skills carry opaque references
  (`s0`, `s1`) because a model told `- Name (level)` returns *"Name (level)"* as
  the name, which cost two entire generations to find.
- **No canonical fallback.** A subject nobody curated has nothing to fall back
  to, so generation fails honestly rather than shipping a thin pack.

### E1 — Foundation (days 1–3)
**Why:** everything else sits on it.
**Build:** Next.js 15 App Router with the `(marketing)`/`(app)` split · Drizzle schema for all bold entities in §15 · Neon + migrations · Better Auth · Inngest wiring · PostHog + Sentry + Langfuse · CI (typecheck, lint, test, migrate) · Vercel preview deploys.
**Accept:** a signed-in user can reach an empty `/today`; `curl` on `/` shows fully server-rendered HTML with metadata in `<head>`; a trivial Inngest job runs and is traced.

### E2 — Domain Pack system (days 3–5)
**Why:** the horizontal mandate requires a data-driven domain layer.
**In:** the hand-authored SQL pack from Phase 0 as YAML.
**Out:** pack loader + validator (DAG cycle check, orphan-skill check, rubric-coverage check, item-count minimum) · seed script · pack admin viewer.
**Dep:** E1.
**Accept:** the SQL pack loads; a deliberately cyclic pack fails the build with a clear error; `/admin/packs` renders the graph.

### E3 — Goal intake + skill graph (days 5–7)
**Why:** the entry point.
**In:** free-text goal.
**Out:** `LearningGoal` with a structured `GoalSpec`; matched or generated pack; pruned personal skill subgraph.
**Dep:** E2.
**Accept:** ≤6 turns, always; a goal with no matching pack triggers Generated-pack creation and still produces a usable graph; every prompt is versioned and traced.

### E4 — Adaptive diagnostic (days 7–9)
**Why:** "don't waste my time learning what I know" is the promise.
**In:** goal, skill subgraph, item bank.
**Out:** `AssessmentResult[]`, seeded `LearnerSkillMastery` per skill with confidence.
**Dep:** E3.
**Accept:** converges in ≤12 items for 90% of learners; an expert-level tester is correctly placed at high mastery on ≥80% of skills they actually know; runs anonymously for the free `/check/*` tool.

### E5 — Mastery model + planner (days 9–11) — **the core engine**
**Why:** §16. This is the product's brain and it is pure code.
**In:** mastery states, skill graph, constraints, session history.
**Out:** `LearningPlan` rows with a `reason` string; the spaced-retrieval queue.
**Dep:** E4.
**Accept:** **unit-tested against 20 hand-written scenarios** (fresh beginner · expert with one gap · returning after 3 weeks · repeatedly failing one skill · hard deadline · 1h/week vs 20h/week). Runs in <50ms. Fully deterministic — identical inputs give byte-identical output. **No LLM call in this path.**

### E6 — Curriculum generation + validation (days 11–13)
**Why:** the visible artefact of the plan; the validator is the anti-mediocrity gate.
**Out:** `Curriculum` + `CurriculumModule[]` + `validatorReport`.
**Dep:** E5.
**Accept:** all nine §14.6 checks run and are reported; a deliberately broken curriculum (missing prerequisite, duplicate modules, 400 hours for a 20-hour budget) is caught and repaired; the path page renders the DAG and shows what was skipped and why.

### E7 — Session engine + tutor (days 13–16)
**Why:** the daily surface.
**Out:** rendered session blocks; streamed tutor chat; `Interaction` logging.
**Dep:** E6.
**Accept:** a 30-minute session renders in <3s to first token; ≤50% `explain` blocks enforced in code; every session opens with retrieval items; tutor context is cached (`cache_read_input_tokens > 0` asserted in tests).

### E8 — Submission + Evaluation Agent (days 16–21) — **the differentiator** — 🟡 built, awaiting the calibration corpus
**Why:** §14.5. This is the product.
**In:** artefacts (repo URL / file / paste / image / audio), rubric.
**Out:** `Evaluation` with per-criterion scores + evidence quotes + confidence; `MasteryUpdate` rows.
**Dep:** E7, E5.
**Accept:**
- Tier 1 code execution runs tests and the verdict respects the results
- **Every criterion score quotes the artefact; the verifier rejects any that doesn't**
- On the Phase-0 hand-graded set, model-vs-human agreement is **Cohen's κ ≥ 0.6**
- Two runs on the same submission land within one rubric band ≥85% of the time
- p95 latency < 120s; user sees live progress
- Confidence band and evidence tier are displayed
- Failures degrade gracefully: queued, retried, and the user is emailed — never a silent loss

### E9 — Mastery map + progress (days 21–23)
**Out:** `/mastery` with evidence-linked "what I can do" statements; `/progress` weekly digest.
**Accept:** every capability statement links to the artefact that proves it; decay is visible; **no percentage-complete anywhere in the UI.**

### E10 — SEO infrastructure (days 20–25, parallel with E9)
**Out:** all page templates · `sitemap.ts` (indexable-only) · `robots.ts` · JSON-LD helpers · `generateMetadata` per route · internal-link renderer · dynamic OG images · the quality-score job.
**Accept:** Lighthouse SEO 100 and Performance ≥95 on every marketing template · valid JSON-LD in Google's Rich Results Test · sitemap contains only `indexable: true` pages · **`curl` confirms metadata in `<head>`, ahead of body content** · GSC and Bing WMT verified.

### E11 — Free tools + precomputed roadmap cache (days 23–26)
**Out:** `/check/{skill}` anonymous flow · roadmap generator with the precompute pipeline · time calculator · rate limiting + Turnstile.
**Accept:** a check completes with no signup; a cached roadmap returns in <200ms with zero AI cost; the abuse limits actually trigger; the anonymous check result is preserved through signup.

### E12 — Content production (days 24–28)
**Out:** 50 pages written, scored, human-reviewed, published.
**Accept:** every page scores ≥75 and has been read end to end by you; ≥4 internal links out and ≥2 in; every external link returns 200.

### E13 — Billing, emails, launch (days 26–30)
**Out:** Polar/Paddle subscription + webhooks + quota enforcement · per-user spend cap · daily/weekly/eval-ready emails · legal pages · the analytics dashboard from §25.
**Accept:** a full paid signup→cancel cycle works in test mode; the spend cap demonstrably degrades service instead of overspending; the funnel dashboard shows real events end to end.

---

# 25. Analytics

## 25.1 Event schema

Standard envelope on every event: `{ user_id | anonymous_id, session_id, timestamp, page_type, page_slug, source, medium, campaign, locale, plan, experiment_variants[] }`.

**Acquisition & SEO**
`page_viewed` (page_type, slug, referrer, is_organic) · `tool_started` / `tool_completed` (tool, skill, duration_s) · `check_result_shown` (skill, level, confidence) · `cta_clicked` (page_slug, cta_id, position) · `share_clicked` (surface, channel)

**Activation** *(the critical funnel)*
`signup_started` / `signup_completed` (source_page_slug, had_prior_check) · `goal_created` (domain, pack_maturity, is_generated_pack) · `clarification_completed` (turns) · `diagnostic_started` / `diagnostic_completed` (items_served, duration_s, skills_assessed) · `curriculum_generated` (modules, total_hours, validator_warnings) · `first_session_started` / `first_session_completed` · **`first_submission_created`** · **`first_evaluation_received` ← THE ACTIVATION EVENT**

**Engagement & retention**
`session_started` / `session_completed` / `session_abandoned` (block_index_at_exit) · `tutor_message_sent` · `retrieval_item_answered` (skill, correct, was_overdue) · `submission_created` (project, evidence_type, eval_tier) · `evaluation_received` (score, confidence, tier, latency_ms) · `evaluation_rated` (helpful bool) · `evaluation_disputed` · `mastery_threshold_crossed` (skill, from, to) · `plan_adapted` (reason) · `proof_page_published` · `dN_active` (computed: 1/3/7/14/30/60/90)

**Monetization**
`paywall_viewed` (trigger) · `checkout_started` / `subscription_created` (plan, annual bool) · `quota_reached` (quota_type) · `subscription_cancelled` (**reason from an exit survey — mandatory**) · `subscription_reactivated`

**Quality & cost** *(internal)*
`agent_run` (agent, prompt_version, model, tokens_in, tokens_out, cache_read_tokens, cost_cents, latency_ms, status) · `evaluation_verifier_failed` · `curriculum_validator_failed` (check_name) · `content_quality_scored` (page, score, dimensions)

## 25.2 SEO measurement

From GSC API weekly into Postgres: impressions, clicks, CTR, average position **per page and per query**. Joined against PostHog conversion data to produce the table that actually drives decisions:

| Page | Impressions | Clicks | CTR | Pos | Tool starts | Signups | **Signups / 1k impressions** |
|---|---|---|---|---|---|---|---|

**Four standing reports, reviewed monthly:**
1. **Pages with traffic but no conversion** → the CTA or the tool is wrong. Fix the page.
2. **Pages with impressions but low CTR** → title/description problem. Rewrite the metadata.
3. **Pages with zero clicks and <50 impressions after 6 months** → **prune or merge.** Index bloat is a sitewide quality signal.
4. **Queries you rank 5–20 for that you didn't target** → build the page you didn't know you needed. Usually the highest-ROI SEO action available.

## 25.3 The one dashboard you check daily

`New signups` · `Activation rate (→ first evaluation within 7d)` · `D7 / D30 retention` · `Submissions per active user this week` · `Evaluation helpfulness %` · `Paid conversion` · `MRR` · `AI cost per active user` · `Organic clicks (7d rolling)`

Nine numbers. Everything else is diagnostic.

---

# 26. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Evaluation isn't good enough to trust.** The whole thesis fails. | 🔴 Critical | Phase 0 hand-grading calibration *before* building. Published rubrics + mandatory evidence quotes + verifier pass + confidence bands. Dispute flow. 2% human audit. **κ ≥ 0.6 is a launch gate, not a goal.** If κ < 0.5 after tuning, restrict launch to Tier 1 domains only and say so. |
| 2 | **Retention — the AI novelty cliff.** [AI apps churn ~30% faster.](https://www.technewsworld.com/story/ai-apps-generate-revenue-but-struggle-with-retention-180236.html) | 🔴 Critical | Activation = *first graded submission*, not signup. Daily single-action surface. Accountability emails. Push annual plans hard. Pre-committed kill criteria (§17.3) so you find out in 60 days, not 12 months. |
| 3 | **Horizontal = shallow everywhere.** *(Direct consequence of the horizontal choice — this is the main risk you took on.)* | 🔴 Critical | Domain Packs with three declared maturity levels. Evaluation tiers with honest confidence. 12 deep Curated packs carry the revenue while breadth carries the SEO. Visible "Experimental" badges. **Never let a Generated pack claim high confidence.** |
| 4 | **No validation until day 60.** *(Direct consequence of the build-first choice.)* | 🟠 High | Analytics and kill criteria built into the MVP. 15 interviews in weeks 5–8. Ship the free Skill Check in week 4 so real signal arrives before the paid loop is polished. |
| 5 | **SEO takes 12–18 months.** | 🟠 High | Communities + Product Hunt + build-in-public carry months 0–9. Treat SEO as an investment with a delayed payoff, and do not let a flat traffic graph in month 3 cause a panic pivot. |
| 6 | **A big player ships this.** OpenAI/Google/Anthropic add persistent skill tracking. | 🟠 High | Speed. Depth in evaluation and calibration. The verticalised rubric library is not something a general assistant will build. Realistically: this is an acquisition scenario as much as a death scenario. |
| 7 | **roadmap.sh or Ulern adds evaluation.** | 🟠 Medium-high | Likely within 18 months. Your defence is the calibration corpus and cross-domain breadth. **Start collecting from day one.** |
| 8 | **AI costs exceed the model.** | 🟡 Medium | Hard per-user cap in code. Aggressive caching. Model routing. Evaluation quotas as the meter. Monitor cost-per-active-user daily with an alert at $8. |
| 9 | **Google penalises the programmatic pages.** | 🟡 Medium | 50 pages not 5,000; tools not text; `noindex` default; human review on every page; monthly re-scoring; proprietary data mandatory from month 3. |
| 10 | **Solo-founder bandwidth.** 30 days is aggressive for §24. | 🟠 High | The plan is ordered by dependency so a slip pushes the tail, not the core. If you slip: cut SEO pages 26–50 and the roadmap generator, never E5 (planner) or E8 (evaluation). |
| 11 | **Cold-start content quality in Generated packs.** | 🟡 Medium | Curriculum Validator fails closed. Generated packs are badged. Fallback to the nearest Standard pack's canonical path. |
| 12 | **The local-language beachhead fragments effort.** | 🟡 Medium | **Deliberately deferred to month 4.** Translate only proven pages. Kill it if the English cluster hasn't shown traction. |
| 13 | **EU VAT / compliance.** | 🟢 Low | Merchant of Record (Polar/Paddle) from day one. Do not hand-roll it. |
| 14 | **Learner uploads copyrighted or sensitive material.** | 🟡 Medium | PII scrubbing on ingest; explicit ToS; artefacts private by default; redaction controls on Proof Pages; a documented deletion path. |
| 15 | **Model deprecation / price change.** | 🟢 Low | Prompts versioned and model-agnostic; a golden eval set makes model swaps a measured decision rather than a leap. |

---

# 27. First 30 Days

You chose build-first. This plan is aggressive but dependency-ordered — a slip pushes the tail, never the core.

### Week 0 (4 days) — Foundations that prevent rework
- **D1:** Keyword verification (§2.6). Kill the losing terms. Produce the final 50-page list.
- **D2:** Use roadmap.sh Pro, Ulern, Oboe for real. Write down every point of friction.
- **D3:** **Hand-author the complete SQL Curated pack.** 25 skills, dependencies, 40 items, 4 projects with full rubrics. By hand, in YAML.
- **D4:** **Hand-grade 5 real submissions.** Then have Opus 5 grade them with the same rubric. Compute agreement. *This number determines whether the product is feasible.* Register the domain; set up the accounts.

### Week 1 — Skeleton and brain
- **D5–7:** E1 Foundation — Next.js split, Drizzle schema, auth, Inngest, observability, CI.
- **D8–9:** E2 Domain Pack system — loader, validator, seeding.
- **D10–11:** E3 Goal intake + skill graph.
- **End of week:** you can state a goal and get a personalized skill subgraph. Deployed to production behind a flag.

### Week 2 — The engine
- **D12–13:** E4 Adaptive diagnostic (also powering the free tool).
- **D14–15:** **E5 Mastery model + deterministic planner.** *Do not rush this. 20 unit-tested scenarios. This is the brain.*
- **D16–17:** E6 Curriculum generation + Validator.
- **D18:** E7 begins — session engine skeleton.
- **End of week:** goal → diagnostic → validated curriculum → a plan for today, with a reason. The core loop exists minus teaching and grading.

### Week 3 — Teaching and grading
- **D19–20:** E7 complete — session blocks, streamed tutor, retrieval integration.
- **D21–25:** **E8 Submission + Evaluation Agent.** The most important five days of the build. Run the Phase-0 calibration set as an automated eval in CI; do not proceed until κ ≥ 0.6.
- **D26:** E9 Mastery map + progress.
- **End of week:** the complete loop works end to end for the SQL pack. **Run it on yourself for a real goal.**

### Week 4 — Public surface and launch
- **D27–28:** E10 SEO infrastructure + E11 free tools & precomputed cache (parallel).
- **D29:** E12 content — the 16 `/check/*` pages and 14 `/projects/*` pages (the highest-priority 30; the remaining 20 land in week 5).
- **D30:** E13 billing, emails, analytics dashboard. Expand from 1 pack to the top 6 Curated packs (the schema and pipeline are done; this is data entry plus validation).
- **Launch:** soft launch to 3 communities + build-in-public thread. **No Product Hunt yet** — wait until the funnel is instrumented and you've fixed the first round of breakage.

### What NOT to build in these 30 days
Voice · mobile · multi-goal · teams/B2B · community · certificates · gamification beyond a streak · your own code sandbox · integrations · a public API · the beachhead language · Proof Pages *(week 5–6, needs real user data to be non-embarrassing)* · SEO pages 31–50 *(week 5)* · packs 7–12 *(weeks 5–8)* · any design polish beyond "clean and fast."

### Weeks 5–8 (for context — not in the 30 days)
15 user interviews · Proof Pages + quality gate · packs 7–12 · SEO pages 31–120 · the first proprietary-data article · Product Hunt · **the day-60 kill-criteria review (§17.3).**

---

# Verification

How to confirm each piece actually works, end to end:

| Component | Verification |
|---|---|
| **Marketing SEO rendering** | `curl -s https://…/check/python \| head -100` — metadata must be in `<head>` before body content. Then Lighthouse (SEO 100, Perf ≥95) and Google Rich Results Test on every template. |
| **Sitemap correctness** | Fetch `/sitemap.xml`; assert every URL returns 200 and every listed page has `indexable = true` in the DB. Automated test. |
| **App routes not indexable** | `curl` `/today`, `/session/x`, `/mastery` — assert `noindex` in the response and that they're disallowed in `robots.txt`. |
| **Pack integrity** | `pnpm packs:validate` — DAG acyclicity, orphan skills, rubric coverage, item minimums. CI gate. |
| **Planner determinism** | 20 fixture scenarios; snapshot tests; assert byte-identical output on repeat runs and <50ms execution. |
| **Mastery model** | Property tests: mastery is monotonic under repeated correct answers; decays correctly over simulated time; a Tier 5 observation never changes mastery. |
| **Curriculum Validator** | Feed 9 deliberately broken curricula (one per check) and assert each is caught and repaired. |
| **Evaluation quality** | Golden set of 50 hand-graded submissions per Curated pack. CI computes Cohen's κ against expert scores. **Fail the build below 0.6.** Plus a self-consistency test: same submission twice, within one band ≥85%. |
| **Evidence-quote enforcement** | Inject a submission with content the model cannot possibly quote correctly; assert the verifier rejects it. |
| **Prompt caching** | Integration test asserting `cache_read_input_tokens > 0` on the second tutor turn. A silent cache miss triples cost with no error. |
| **Cost guardrails** | Simulate a user exceeding the monthly cap; assert degradation to Sonnet, then queueing, then notification — never uncapped spend. |
| **Free-tool abuse** | Script 50 requests from one IP; assert rate limiting and Turnstile trigger; assert cached roadmaps cost $0. |
| **Full loop, manually** | **Run the entire product on a real goal of your own for two weeks.** Submit real work. If you don't find the evaluations useful, no one will. This is the single most important verification in this list. |

---

## Sources

**Competitors & pricing:** [roadmap.sh Premium](https://roadmap.sh/premium) · [roadmap.sh traffic case study](https://hackmamba.io/case-study/how-roadmap-grew-organic-traffic-by-138-percentage-in-24-months/) · [Ulern](https://ulern.com/) · [Oboe / TechCrunch](https://techcrunch.com/2025/09/10/after-selling-to-spotify-anchors-co-founders-are-back-with-oboe-an-ai-powered-app-for-learning/) · [Oboe review — no diagnostic, no mastery checks](https://tomdaccordai.substack.com/p/obeo-fresh-bite-size-ai-pathways) · [boot.dev pricing & scale](https://www.indiehackers.com/post/creators/hitting-10m-arr-with-rpg-style-programming-courses-b1JEom0xSuVU4EIvPfdf) · [boot.dev review](https://www.coursefacts.com/guides/boot-dev-review-2026) · [Duolingo Max pricing](https://copycatcafe.com/blog/duolingo-max) · [Khanmigo pricing](https://www.myengineeringbuddy.com/blog/khanmigo-reviews-alternatives-pricing-offerings/) · [ChatGPT Study Mode vs Gemini Guided Learning](https://ainativestudent.com/blog/chatgpt-study-mode-vs-gemini-guided-learning/) · [Gemini Guided Learning launch](https://techcrunch.com/2025/08/06/google-takes-on-chatgpts-study-mode-with-new-guided-learning-tool-in-gemini/) · [AdaptLearn](https://adaptlearn.co/)

**Retention & AI-app benchmarks:** [AI apps churn 30% faster (21.1% vs 30.7% annual)](https://www.technewsworld.com/story/ai-apps-generate-revenue-but-struggle-with-retention-180236.html) · [Retention paradox / 8.5% vs 5.6% trial conversion](https://www.creem.io/blog/ai-app-retention-paradox-churn-2026) · [AI tourist churn](https://www.ndnanalytics.com/blog/ai-tourist-churn-saas-activation)

**Learning engine:** [BKT vs LLM in production; 3-of-4 thin wrappers, sub-12% D30](https://www.forasoft.com/blog/article/ai-tutors-adaptive-learning-2026) · [Bayesian Knowledge Tracing](https://www.emergentmind.com/topics/bayesian-knowledge-tracing) · [LLMs for BKT/DKT](https://link.springer.com/chapter/10.1007/978-3-031-98281-1_14)

**Evaluation quality:** [Rubric Is All You Need — question-specific rubrics for code evaluation, ICER 2025](https://dl.acm.org/doi/10.1145/3702652.3744220) · [Reliable LLM grading via self-consistency + selective human review](https://www.mdpi.com/2504-4990/8/3/74) · [Confusion-Aware Rubric Optimization](https://arxiv.org/html/2603.00451) · [Comparative study of LLM grading in programming education](https://www.sciencedirect.com/science/article/pii/S2590291126007096)

**SEO:** [Google scaled content abuse policy](https://patrickstox.com/programmatic-seo/risks/scaled-content-abuse/) · [March 2026 enforcement: 60–90% losses](https://www.digitalapplied.com/blog/scaled-content-abuse-google-march-update-ai-pages-decimated) · [Programmatic SEO after March 2026](https://www.digitalapplied.com/blog/programmatic-seo-after-march-2026-surviving-scaled-content-ban) · [Next.js 15 App Router SEO checklist](https://blog.simplr.sh/posts/next-js-15-app-router-seo-checklist/) · [Next.js metadata streaming SEO regression](https://javascript.plainenglish.io/next-js-15-app-router-killed-our-seo-for-2-months-and-how-we-fixed-it-bfcc616c6dac)

**Model pricing** (Anthropic API, first-party rates): Opus 5 $5/$25 · Sonnet 5 $3/$15 ($2/$10 intro through 2026-08-31) · Haiku 4.5 $1/$5 per MTok. Cache reads ~0.1× input; cache writes 1.25×; Batch API 50% off.

**Unverified:** all per-keyword search volumes and difficulty scores. Not included as facts anywhere in this plan; §2.6 specifies the week-1 verification protocol.
