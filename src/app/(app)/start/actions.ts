"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb, type Db } from "@/db";
import { mayBuild, mayRestartIntake, mayUseIntake } from "@/lib/billing/quota";
import { getAnthropic } from "@/lib/ai/client";
import { logCall } from "@/lib/ai/runlog";
import { resolvePack } from "@/lib/content/resolve";
import { cookieName } from "@/lib/check/session";
import { runAnalyzer } from "@/lib/goals/analyzer";
import { INTAKE_AT_LATEST, INTAKE_AT_READY } from "@/lib/goals/anchors";
import { catalogueFor, matchChosen, specFrom } from "@/lib/goals/match";
import { clearIntake, loadIntake, saveIntake } from "@/lib/goals/intake-store";
import {
  askedWith,
  contextFor,
  MAX_REPLY,
  recordTurn,
} from "@/lib/goals/turn";
import {
  customSubjectFrom,
  masteryFromCheck,
  parseCustomGoalForm,
  parseGoalForm,
} from "@/lib/goals/intake";
import { slugify } from "@/lib/packs/generate/derive";
import { createGoal, goalsFor } from "@/lib/goals/store";
import { PACK_FIELD, projectStartHref } from "@/lib/goals/project-start";
import type { DomainPack } from "@/lib/packs/types";
import { finishBuild, startBuild } from "@/lib/packs/build";
import { notifyBuildFailed } from "@/lib/packs/notify";
import { EVENTS, inngest } from "@/lib/inngest/client";

/**
 * §8 screen 3 as Server Actions — the conversation, and the form that is still
 * behind it.
 *
 * No client JavaScript, for the same reason the Skill Check has none: this is
 * the screen between signing up and having a plan, and a screen that needs a
 * bundle to download before it works is one some people never get through.
 * Every transition is a POST that ends in a redirect, so a refresh re-renders
 * the conversation instead of re-sending the last answer.
 */

async function requireUser(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session.user.id;
}

/**
 * The course this conversation is committed to.
 *
 * Whatever the intake already holds wins: the lock is set on the turn that
 * opens the conversation and every later turn comes from the composer, which
 * has no course to name. Reading the field on those turns would let an empty
 * one unlock a conversation halfway through.
 *
 * A newly claimed one is *resolved before it is trusted*. This arrives in a
 * form field, so it is a string a signed-in learner can put anything in — and
 * an unchecked one would ride all the way to `createGoal`'s `packId`, which is
 * a foreign key to a pack that need not exist. Anything that does not name a
 * real pack is dropped rather than rejected: the conversation still works, and
 * `matchSubject` decides at the end exactly as it did before.
 */
async function chosenPack(
  db: Db,
  intake: { packSlug: string | null },
  formData: FormData,
): Promise<string | null> {
  if (intake.packSlug) return intake.packSlug;

  const claimed = String(formData.get(PACK_FIELD) ?? "").trim();
  if (claimed.length === 0) return null;

  const pack = await resolvePack(db, claimed);
  return pack?.slug ?? null;
}

/**
 * Hands the claimed build to the worker, and releases the claim if it cannot.
 *
 * `startBuild` writes the row *before* this runs, which is deliberate — the
 * claim is what stops a refresh of the wait screen starting a second build. The
 * consequence is that a failed dispatch leaves a row nobody will ever pick up:
 * the wait screen polls a subject that is not being built, and it polls until
 * `BUILD_TIMEOUT_MINUTES` makes the row stale, showing "writing it now" the
 * whole time.
 *
 * It is worse than a wedged screen on a plan with a lifetime quota. The quota
 * counts build rows, so a queue that was down for ten seconds would have spent
 * a free account's one custom subject on a build that never ran — and lifetime
 * means never getting it back. That is the bug this function exists to prevent.
 *
 * So a dispatch failure marks the row `failed` with a truthful reason and tells
 * the team, exactly as a failure inside the worker does: the quota is untouched,
 * the learner is told what happened, and somebody who can act on it finds out.
 * §24 E8's "queued, retried, and the user is told — never a silent loss",
 * applied to the step before the queue.
 *
 * The most likely cause in development is the Inngest dev server not running
 * (`pnpm inngest:dev`, or the `inngest` service in `docker-compose.yml`); in
 * production it is the event API being briefly unreachable. Both look the same
 * from here and both want the same answer.
 */
async function dispatchBuild(
  db: Db,
  input: { slug: string; subject: string; userId: string },
): Promise<boolean> {
  try {
    await inngest.send({
      name: EVENTS.buildPack,
      data: { slug: input.slug, subject: input.subject, userId: input.userId },
    });
    return true;
  } catch (error) {
    /*
     * Logged as well as recorded, because the two readers need different
     * things. The learner gets the sentence below — true, and useless for
     * debugging. Whoever is running the server gets the cause, which is the
     * half that was missing when this first happened: the action threw
     * `fetch failed` with no indication that the thing it could not reach was
     * the Inngest dev server nobody had started.
     */
    console.error("[packs] could not queue a build for", input.slug, error);

    /*
     * No "try again" in it, because there is nothing here for the learner to
     * press. The retry button was deliberately removed from the wait screen —
     * a retry is four model calls and about a pound, guessed at by the one
     * person who cannot tell a bad subject from a bad afternoon — so a reason
     * ending in "try again" sent them looking for a control that is not there.
     * It is also the line an operator reads as `Reason:` in the mail below.
     */
    const detail = "We couldn't get this into the queue, so it never started.";

    await finishBuild(db, input.slug, { status: "failed", detail });

    /*
     * The half that was missing, and the reason this function is not simply
     * `finishBuild` inline.
     *
     * `notifyBuildFailed` used to be reachable only from the worker, so the one
     * failure that never reaches the worker — this one — was the one nobody was
     * told about. The learner was still shown "our team has been told", which
     * was false precisely when it mattered most: a dispatch failure means the
     * queue itself is down, which is the thing you most want to hear about and
     * the thing least likely to be noticed on its own.
     *
     * After `finishBuild`, so the mail cannot describe a state the database does
     * not yet have — the same order the worker's `finish` uses. Nothing is read
     * back off the row first, because unlike the worker this already holds every
     * fact the mail needs.
     */
    await notifyBuildFailed(db, {
      slug: input.slug,
      subject: input.subject,
      detail,
      userId: input.userId,
    });
    return false;
  }
}

/**
 * Asks the queue to cut the new goal into modules.
 *
 * Every goal has always needed this and no goal ever got it: `EVENTS.buildPath`
 * had no sender, so the only way to a curriculum was a button on `/path` that
 * nothing in the product linked to. A learner without one has no checkpoints,
 * which is why `/calendar` opened empty on a course that had only just been
 * built, and their outline stays grouped by the pack's own
 * areas rather than by modules that each end in something they hand in.
 *
 * Queued rather than awaited, for §14.9.3's reason and not merely for speed:
 * generation is up to two model calls and tens of seconds, and the learner is
 * on their way to `/today`, which does not read the curriculum. Nothing they are
 * about to look at is waiting on this.
 *
 * **A dispatch failure is not allowed to cost them the goal.** Unlike a pack
 * build there is no quota to protect and no row to mark — the goal is already
 * written, `/today` already works, and the path screen still lays the whole
 * subject out from the pack's areas. So this is logged for whoever is running
 * the server (in development the usual cause is the Inngest dev server not
 * running — `pnpm inngest:dev`, or the `inngest` service in
 * `docker-compose.yml`) and swallowed. "Build my path" on the path screen is
 * what the learner is left with, which is exactly what every learner had before
 * this function existed.
 */
async function dispatchPathBuild(userId: string, goalId: string): Promise<void> {
  try {
    await inngest.send({
      name: EVENTS.buildPath,
      data: { userId, goalId },
    });
  } catch (error) {
    console.error("[goals] could not queue a path build for", goalId, error);
  }
}

/**
 * §7.1's Generated tier, and the quota that lets the free tier have one.
 *
 * Authoring a pack costs ~78¢ — six times what is left of a free month's
 * allowance once onboarding, a session and an evaluation are paid for. It used
 * to be refused outright on free, which made the free tier "the seven subjects
 * we happen to have"; it is now allowed exactly once per account, ever, and
 * charged to the catalogue rather than to the learner (`subsidisesPackBuilds`).
 *
 * The subject is part of the question, not just the learner — see `mayBuild`,
 * which is where the count and the ownership meet. Asking with the learner
 * alone is what made "Try again" refuse the retry of the subject the quota had
 * already been spent on.
 *
 * Checked before `startBuild`, not after: `startBuild` claims the slug, and a
 * claim we then refuse to honour would lock the subject behind a build that
 * never runs.
 */
/**
 * Refuses a learner who has already spent their one custom subject.
 *
 * Checked in every action that costs a model call or can commission a build,
 * not only on the page that renders them: a server action is a public endpoint
 * whatever the screen around it looked like, and the screen is a cache of a
 * decision this makes fresh.
 *
 * `?error=generated` rather than a new code, because it is the same fact the
 * learner has already been told — you have had the custom subject your plan
 * builds — arriving at the door instead of after five questions.
 */
async function requireIntakeOpen(db: Db, userId: string): Promise<void> {
  if (!(await mayUseIntake(db, userId))) redirect("/start?error=generated");
}

async function requireBuildAllowance(db: Db, userId: string): Promise<void> {
  if (!(await mayBuild(db, userId))) redirect("/start?error=generated");
}

/**
 * Refuses to throw away a conversation this account cannot open again.
 *
 * Both ways out of a conversation clear it — "Start over", and starting on a
 * subject they arrived holding — so both come through here rather than each
 * asking the question its own way. The screens above already hide the offer on
 * a plan that does not include it; this is the same decision made where it
 * counts, because a server action is a public endpoint whatever was rendered.
 *
 * **The order is deliberate.** The conversation is read first, and an empty one
 * is let through without the plan ever being consulted: there is nothing to
 * discard, so nothing to refuse, and a learner arriving from a brief with no
 * conversation at all must not be turned away from their first one. It also
 * costs one indexed read rather than an entitlement lookup on the common path.
 */
async function requireDiscardable(db: Db, userId: string): Promise<void> {
  const stored = await loadIntake(db, userId);
  if (stored.messages.length === 0) return;

  if (!(await mayRestartIntake(db, userId))) redirect("/start?error=restart");
}

/**
 * §7.1's Generated tier, from the point where the subject is settled.
 *
 * Shared by the conversation and the form for the reason `finish` is: they are
 * two ways of saying what to build, not two things to build. The build is
 * claimed here rather than on the wait screen so that a refresh of that screen
 * cannot start a second one.
 */
async function beginBuild(
  db: Db,
  userId: string,
  input: { slug: string; subject: string },
): Promise<never> {
  await requireBuildAllowance(db, userId);

  const started = await startBuild(db, { ...input, userId });

  if (started.kind === "rate-limited") redirect("/start?error=busy");
  if (started.kind === "started") await dispatchBuild(db, { ...input, userId });

  // The wait screen either way: a dispatch that failed has marked the row, and
  // that screen is where a stopped build is explained.
  redirect(`/start/building?subject=${encodeURIComponent(input.slug)}`);
}

/**
 * Creates the goal and sends the learner to their path.
 *
 * Shared by both intakes, so the conversation and the form cannot drift into
 * creating subtly different goals — which was the reason `GoalSpec` was written
 * before either of them existed.
 */
async function finish(
  userId: string,
  // The pack itself, not its slug: every caller has already resolved one, and
  // resolving it again here only added a branch that cannot be reached.
  pack: DomainPack,
  spec: Parameters<typeof createGoal>[1]["spec"],
): Promise<never> {
  const db = getDb();
  const jar = await cookies();
  const now = new Date();

  // §24 E11 — whatever they already answered anonymously comes with them.
  // Replayed through the engine rather than trusted (see intake.ts).
  const mastery = masteryFromCheck(
    pack,
    jar.get(cookieName(pack.slug))?.value,
    now.toISOString(),
  );

  const goalId = await createGoal(db, {
    userId,
    packSlug: pack.slug,
    spec,
    mastery,
    now,
  });

  // Before the redirect, so the work is already queued by the time the path
  // screen renders — and after `createGoal`, because the goal id is what the
  // worker is being asked about.
  await dispatchPathBuild(userId, goalId);

  // The conversation has done its job; leaving it behind would greet them with
  // their old answers the next time they set a goal.
  await clearIntake(db, userId);

  /*
   * The path screen, which is the next thing that has to happen.
   *
   * Both intakes still end in the same place — that was always the point, and
   * it holds — but the place was wrong. `createGoal` does not build a path;
   * `buildPathAction` does, and it lives on `/path` behind a button.
   * So a learner who had just waited six minutes for a course landed on
   * `/today`, which has no session to offer because nothing has been planned
   * yet, and no obvious way to say so. `/calendar` already handles the same
   * state by pointing at this screen — "your path hasn't been built yet" —
   * which is the tell that it, and not `/today`, is where a new goal begins.
   *
   * `goalId` was already being computed and thrown away with `void goalId` to
   * satisfy the linter. It is the answer.
   */
  redirect("/path");
}

/* ── The conversation ─────────────────────────────────────────────────────── */

/**
 * One exchange: the learner says something, the analyzer replies.
 *
 * The turn cap is enforced here rather than in the prompt (§24 E3), and it is
 * enforced twice — once by telling the model this is its last turn, and once by
 * ending the conversation whatever the model returns.
 */
export async function replyAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  // Before the model call, not after: a turn on a conversation that can never
  // produce anything is money spent on a screen the learner will not be shown.
  await requireIntakeOpen(db, userId);

  const said = String(formData.get("reply") ?? "").trim().slice(0, MAX_REPLY);
  if (said.length === 0) redirect("/start");

  const stored = await loadIntake(db, userId);
  if (stored.done) redirect("/start");

  // The course they chose, folded in before the model is asked anything — so
  // the very first question is about them rather than about a subject they
  // have already picked, and so the lock is saved even if this turn fails.
  const intake = {
    ...stored,
    packSlug: await chosenPack(db, stored, formData),
  };

  const messages = askedWith(intake, said);

  const result = await logCall(
    db,
    userId,
    await runAnalyzer(getAnthropic(), contextFor(intake, messages)),
  );

  const { ok, done } = await recordTurn(db, userId, intake, messages, result);
  /*
   * Back to the brief, when that is where they came from.
   *
   * The analyzer failing is the one path that returns somebody to `/start`
   * rather than moving them along it, and a bare `/start?error=analyzer` drops
   * the project — so a reader who had read a rubric end to end, pressed the
   * button, and hit a bad minute from the model landed on an empty intake with
   * no sign of the work they turned up for. The brief screen carries its slug
   * in a hidden field precisely so this redirect can put them back on it.
   *
   * Only the opening turn has one. Every later turn comes from the composer,
   * which has no brief to name — by then the project is in the conversation
   * itself, and the generic screen is the right place to land.
   */
  const brief = String(formData.get("project") ?? "");
  if (!ok) {
    redirect(brief ? projectStartHref(brief, "analyzer") : "/start?error=analyzer");
  }

  /*
   * To the new question rather than the top of the page — the pinned composer
   * covers the tail of the conversation otherwise.
   *
   * Unless that answer was the last one, in which case there is no new question
   * and the composer is gone: the turn that closes the conversation lands on the
   * button that builds the plan, which is now the only thing left to do here.
   */
  redirect(done ? INTAKE_AT_READY : INTAKE_AT_LATEST);
}

/** Opens the conversation, so the first question comes from the analyzer. */
export async function openAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  await requireIntakeOpen(db, userId);

  const result = await logCall(
    db,
    userId,
    await runAnalyzer(getAnthropic(), {
      messages: [],
      catalogue: catalogueFor(),
      today: new Date().toISOString().slice(0, 10),
      finalTurn: false,
    }),
  );

  if (result.status !== "ok") redirect("/start?error=analyzer");

  await saveIntake(db, userId, {
    messages: [{ r: "a", t: result.value.reply }],
    captured: result.value.captured,
    chips: result.value.chips,
    clarity: result.value.clarity,
    done: false,
    // The bare `/start` button, which is the one way in that names no course:
    // a learner who arrived from a brief or a subject page is seeded with
    // something to say, and goes through `replyAction` instead.
    packSlug: null,
  });

  redirect(INTAKE_AT_LATEST);
}

/**
 * Throws the conversation away and starts again — on the plans that include it.
 *
 * §7.1's free tier keeps one conversation. It stays editable to the last moment
 * (`reopenAction`), which is what a learner who got something wrong actually
 * needs; what it does not get is a reroll, because six fresh questions is six
 * fresh model calls and the free budget has one conversation in it.
 */
export async function restartAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  await requireDiscardable(db, userId);
  await clearIntake(db, userId);
  redirect("/start");
}

/**
 * Puts a finished conversation back in front of the learner so they can change
 * an answer.
 *
 * The edit that replaces "start over" for everyone it was ever the wrong tool
 * for. A conversation closes the moment the analyzer has enough, and until now
 * the only way past a wrong answer was to discard all of them — which is a
 * strange price for "I said four hours and I meant fourteen", and on a free
 * account it is a price they cannot pay at all.
 *
 * Nothing is lost and nothing is re-asked: the messages, the captured fields and
 * the committed course all stay exactly as they are, `done` goes back to false,
 * and the composer returns under the conversation they already had. The next
 * turn revises what was captured the same way every other turn does, and the
 * analyzer closes it again — see `shouldFinishNext`, which is already true by
 * the time a conversation is done, so this buys one corrected turn rather than a
 * conversation that can be reopened into a second interview.
 */
export async function reopenAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  await requireIntakeOpen(db, userId);

  const intake = await loadIntake(db, userId);
  // Only a finished one. Writing regardless would upsert a row for somebody who
  // has no conversation at all, which is a stored empty intake where there was
  // nothing before.
  if (intake.done) await saveIntake(db, userId, { ...intake, done: false });

  redirect(INTAKE_AT_LATEST);
}

/**
 * Puts an unfinished conversation aside and opens a new one on a subject they
 * arrived holding.
 *
 * Someone who searches for a subject we do not cover, is told we will build it,
 * and clicks through, is asking for that subject — but they may already have an
 * abandoned conversation about something else, and `/start` would render that
 * one and drop the subject on the floor. That is exactly what it did: arriving
 * at `/start?topic=javascript` showed a half-finished conversation about
 * Japanese, with no sign the topic had been read at all.
 *
 * Clearing is safe: an intake that produced a goal is already deleted, so
 * anything still sitting here never became a plan. It is still not done without
 * asking — the screen offers this and the old conversation side by side.
 */
export async function startFreshAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  // Before the intake is cleared. Otherwise a learner who cannot open a new
  // conversation loses the one they had to a refusal.
  await requireIntakeOpen(db, userId);
  // And before that conversation is replaced by this one. Arriving with a
  // subject in hand is still a discard when there is something to discard —
  // this is the same refusal "Start over" gets, reached from the other door.
  await requireDiscardable(db, userId);
  await clearIntake(db, userId);

  // Straight into the conversation rather than back to a Start button: they
  // have already said what they want, twice.
  await replyAction(formData);
}

/**
 * Turns a finished conversation into a goal.
 *
 * A course the learner chose on the way in is the course they get. Otherwise a
 * subject the catalogue covers goes straight to a plan, and one it does not is
 * handed to §7.1's Generated tier, which is the whole point of the screen
 * accepting anything in the first place.
 */
export async function buildFromConversationAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  await requireIntakeOpen(db, userId);

  const intake = await loadIntake(db, userId);
  if (!intake.captured) redirect("/start");

  const match = await matchChosen(db, intake.captured, intake.packSlug);

  if (match.kind === "gap") {
    if (match.slug.length === 0) redirect("/start?error=subject");

    return beginBuild(db, userId, { slug: match.slug, subject: match.subject });
  }

  const spec = specFrom(
    intake.captured,
    intake.messages,
    match.pack.slug,
    match.pack.name,
    intake.clarity,
  );
  if (!spec) redirect("/start?error=subject");

  await finish(userId, match.pack, spec);
}

/* ── The form, still here ─────────────────────────────────────────────────── */

/**
 * Back to the form, saying what went wrong and holding on to what they typed.
 *
 * The subject rides along because the box is the one field on this form that
 * cannot be refilled from the list: a rejected form used to come back with
 * "Rust" gone and Photography selected, which is the same small betrayal
 * `/start` carries a typed topic through sign-in to avoid.
 */
function backToForm(error: string, subject: string): string {
  const params = new URLSearchParams({ error });
  if (subject.length > 0) params.set("subject", subject);

  return `/start/form?${params.toString()}`;
}

/**
 * A subject the form asked for and the catalogue does not have.
 *
 * The same Generated tier the conversation reaches, from the intake that has no
 * model behind it. What it does first is write down the answers: from here on
 * the pack does not exist yet, so a `GoalSpec` cannot, and everything they told
 * us has to survive a wait of some minutes, a queue that might refuse it, and a
 * build that might stop. The wait screen adopts from exactly this intake when
 * the pack lands — the same one the conversation would have left.
 */
async function buildCustomSubject(
  db: Db,
  userId: string,
  subject: string,
  formData: FormData,
): Promise<never> {
  const parsed = parseCustomGoalForm(formData, subject);
  if (!parsed.ok) redirect(backToForm(parsed.error, subject));

  /*
   * Whatever conversation was held is replaced, without asking.
   *
   * `finish` has always done this — a form submitted for a subject we cover
   * clears the intake on its way to `/today` — so the form has never been the
   * screen that preserves a half-finished chat. Doing it here keeps the two
   * halves of the same form consistent, rather than making a custom subject
   * the one submission that can fail because of something you typed elsewhere.
   */
  await saveIntake(db, userId, parsed.intake);

  return beginBuild(db, userId, { slug: slugify(subject), subject });
}

/**
 * The no-conversation path.
 *
 * Kept rather than deleted: it is the fallback when the analyzer is unavailable,
 * and it is the only intake that works with JavaScript and a model both out of
 * the picture. It fills the same `GoalSpec` — and, since the list can never be
 * the whole answer, it reaches the same builder for a subject that is not on it.
 */
export async function createGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  /*
   * What they typed, and what that resolves to.
   *
   * A typed subject is looked up the same way the conversation looks up the
   * analyzer's: slugified against the catalogue. Someone who types "Photography"
   * into the box has picked Photography, and building a second pack for it
   * would be a worse answer to a better-spelled question.
   */
  const typed = customSubjectFrom(formData);
  const chosen = typed.length > 0 ? slugify(typed) : String(formData.get("topic") ?? "");

  const pack = await resolvePack(db, chosen);
  if (!pack) {
    // Nothing typed and nothing matched: either the radio named a pack that is
    // no longer there, or "Something else" was chosen with an empty box.
    if (typed.length === 0) {
      redirect(backToForm("Pick a subject, or tell us what you want to learn.", ""));
    }

    return buildCustomSubject(db, userId, typed, formData);
  }

  const parsed = parseGoalForm(formData, pack);
  if (!parsed.ok) redirect(backToForm(parsed.error, typed));

  await finish(userId, pack, parsed.spec);
}

/* ── The wait screen's two buttons ────────────────────────────────────────── */

/**
 * Turns a pack that finished building into this learner's goal.
 *
 * The conversation is still stored, so the spec is built from the same captured
 * fields a covered subject would have used — the two paths differ only in
 * whether the pack existed when they started.
 */
export async function adoptBuiltPackAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const slug = String(formData.get("slug") ?? "");
  const pack = await resolvePack(db, slug);
  if (!pack) redirect("/start?error=subject");

  /*
   * Already adopted — which is to say, the button pressed twice.
   *
   * `finish` clears the intake on its way out, so the second press found no
   * captured answers and fell through to `/start`. On a free account that is
   * the closed-intake wall, which says "we built you a course for a subject
   * nobody had curated" and then offers the catalogue and a price list — a
   * learner bounced off their own finished course by the button that exists to
   * take them to it. The wait screen is a URL people keep open and reload, so
   * this is not an exotic path.
   *
   * Idempotent instead: the goal already exists, so go to it. Read from
   * `goalsFor` rather than the intake because the goal is the durable fact —
   * the intake is scratch that is *meant* to be gone by now.
   */
  const adopted = (await goalsFor(db, userId)).find(
    (goal) => goal.packSlug === pack.slug,
  );
  if (adopted) redirect("/path");

  const intake = await loadIntake(db, userId);
  if (!intake.captured) redirect("/start");

  const spec = specFrom(
    intake.captured,
    intake.messages,
    pack.slug,
    pack.name,
    intake.clarity,
  );
  if (!spec) redirect("/start?error=subject");

  await finish(userId, pack, spec);
}

/**
 * Leaves a stopped build behind and goes back to choosing.
 *
 * What is left of the old retry action, and the deletion is the change. A
 * learner used to be able to press "Try again", which spent four model calls
 * and about a pound on a guess — on the free tier, the catalogue's pound — made
 * by the one person with no way to tell a subject that cannot be built from an
 * afternoon when Anthropic was slow. Worse, it made a failure their problem to
 * solve by pressing a button repeatedly.
 *
 * A stopped build is now ours: the team is emailed when the row is written, and
 * retrying lives behind `requireAdmin` at `/admin/packs`. All this does is let
 * somebody stop waiting.
 *
 * The row is left exactly as it is. It is the operator's queue now, and
 * `mayBuild` already treats a subject this learner owns as retryable without
 * spending their allowance again — so deleting it here would cost them the
 * subject as well as the wait.
 */
export async function abandonBuildAction(): Promise<void> {
  await requireUser();
  redirect("/start");
}
