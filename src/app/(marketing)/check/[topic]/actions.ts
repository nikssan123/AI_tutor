"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAnthropic, hasApiKey } from "@/lib/ai/client";
import { findPack } from "@/lib/content";
import {
  gradeAuto,
  gradingModeFor,
  type DiagnosticItem,
} from "@/lib/engine/diagnostic";
import { markOpenAnswer, markPhotoAnswer } from "@/lib/check/mark";
import { cookieFor, narrow, pathFor, type CheckRef } from "@/lib/check/run";
import {
  decode,
  encode,
  MAX_ANSWER,
  MAX_FEEDBACK,
  needsSelfMark,
  type CheckCookie,
} from "@/lib/check/session";

/**
 * The Skill Check's transitions, as Server Actions.
 *
 * In their own module rather than inline in the page for two reasons: a "use
 * server" file can be imported and called directly by a test, and it keeps the
 * page a pure function of its cookie. Every action ends in a redirect back to
 * the same URL, so a refresh after answering re-renders the next question
 * instead of resubmitting the last one.
 *
 * **One set of actions for both checks.** Each takes a `CheckRef` — a subject,
 * and a skill for the deep check on one skill (§24 E11's `/check/{skill}`) —
 * which decides the cookie, the item pool and the path to return to. Two sets
 * would be two places deciding what a marked answer is worth.
 */

const SIX_HOURS = 60 * 60 * 6;

async function write(ref: CheckRef, next: CheckCookie): Promise<void> {
  const jar = await cookies();
  jar.set(cookieFor(ref), encode(next), {
    /*
     * Site-wide, and this is the whole of §24 E11's "the anonymous check result
     * is preserved through signup".
     *
     * It was `/check/${topic}`, on the reasoning that a cookie should go no
     * further than the thing that wrote it — which is right for a secret and
     * wrong for this one. A path-scoped cookie is not sent to `/start`,
     * `/today` or `/subjects`, and all three read it: `masteryFromCheck` seeds
     * a new goal's mastery from it, and `answeredTopics` is what puts "Your
     * check comes with you" on a subject row. None of them had ever received
     * it. The carry-in was written, tested against a jar handed straight to the
     * function, and could not happen in a browser — the failure a unit test
     * cannot see, because the browser is the part that decides.
     *
     * What it holds is item slugs and a 0 or 1 each. It stays `httpOnly` and
     * `sameSite: lax` and expires in six hours.
     */
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SIX_HOURS,
  });
}

async function read(ref: CheckRef): Promise<CheckCookie> {
  const jar = await cookies();
  return decode(jar.get(cookieFor(ref))?.value);
}

/** The pool this check draws from — the whole subject, or one skill of it. */
function itemsFor(ref: CheckRef): DiagnosticItem[] {
  const pack = findPack(ref.topic);
  return pack ? narrow(pack, ref).items : [];
}

/** Starts a check, and restarts a finished one — the same thing. */
export async function startCheck(ref: CheckRef): Promise<void> {
  await write(ref, { s: 1, a: [] });
  redirect(pathFor(ref));
}

/**
 * One answer.
 *
 * A closed item is decided here by equality. An open one goes to §14.2's
 * Assessment Agent — and when that cannot happen (no key, no budget, a failed
 * call) it falls back to what this check has always done: park the answer, show
 * the learner the key, and let them mark themselves, which §7.2 makes Tier 5
 * and which therefore never counts as mastery.
 *
 * The two outcomes are deliberately different states rather than one with a
 * flag. A marked answer is *recorded* and shows the marking; a parked one is
 * not recorded at all until the learner has said how it went.
 */
export async function submitAnswer(
  ref: CheckRef,
  formData: FormData,
): Promise<void> {
  // Any previous upload refusal is dropped here rather than in each branch: the
  // learner is answering again, so whatever the last file was wrong about is
  // over. Only the refusal branch below puts one back.
  const { e: _cleared, ...cookie } = await read(ref);
  const slug = String(formData.get("item") ?? "");
  const pack = findPack(ref.topic);
  const item = itemsFor(ref).find((i) => i.slug === slug);

  // A stale or forged form is dropped rather than recorded against the wrong
  // item — the check would rather ask again than log a fiction.
  if (pack && item) {
    const response = String(formData.get("response") ?? "");

    const deps = { db: getDb, client: hasApiKey() ? getAnthropic() : null };
    // The bar is the skill's own can-do statement — the sentence the page prints
    // as "what counts as knowing this". Asserted rather than defaulted:
    // `validatePack` rejects a pack whose item names a skill it does not define.
    const expected = pack.skills.find((s) => s.slug === item.skill)!
      .canDoStatement;

    /*
     * §7.3's photograph, checked *before* the closed branch below.
     *
     * `needsSelfMark` is false for a `micro_artifact` as well as for an mcq —
     * one is "the learner cannot mark this", the other is "nobody has to" — so
     * whichever branch comes first catches it. With the order the other way
     * round a photograph was graded as a wrong multiple-choice answer, silently
     * and against the learner.
     *
     * The file is read, sent, marked and dropped — nothing is stored, which is
     * what lets the page say "we do not keep it".
     *
     * A refusal is the learner's to fix (wrong format, too large) and comes
     * back to the same question with a sentence saying so. Everything else
     * falls back to self-marking exactly as a written answer does.
     */
    if (gradingModeFor(item.type) === "excluded") {
      const photo = formData.get("photo");
      const outcome =
        photo instanceof File
          ? await markPhotoAnswer(deps, {
              question: item.prompt,
              expected,
              file: photo,
              note: response,
            })
          : { marking: null, refused: "wrong-type" as const };

      if (outcome.refused !== null) {
        await write(ref, { ...cookie, e: outcome.refused });
        redirect(pathFor(ref));
      }

      await write(
        ref,
        outcome.marking === null
          ? { ...cookie, p: { i: item.slug, r: response.slice(0, MAX_ANSWER) } }
          : {
              ...cookie,
              a: [
                ...cookie.a,
                { i: item.slug, c: outcome.marking.correct ? 1 : 0, g: 1, k: 1 },
              ],
              m: {
                i: item.slug,
                c: outcome.marking.correct ? 1 : 0,
                f: outcome.marking.feedback.slice(0, MAX_FEEDBACK),
                r: response.slice(0, MAX_ANSWER),
              },
            },
      );
      redirect(pathFor(ref));
    }

    if (!needsSelfMark(item)) {
      await write(ref, {
        ...cookie,
        a: [...cookie.a, { i: item.slug, c: gradeAuto(item, response) ? 1 : 0 }],
      });
      redirect(pathFor(ref));
    }

    const marking = await markOpenAnswer(
      deps,
      {
        question: item.prompt,
        expected,
        answer: response,
      },
    );

    await write(
      ref,
      marking === null
        ? { ...cookie, p: { i: item.slug, r: response.slice(0, MAX_ANSWER) } }
        : {
            ...cookie,
            a: [
              ...cookie.a,
              { i: item.slug, c: marking.correct ? 1 : 0, g: 1 },
            ],
            m: {
              i: item.slug,
              c: marking.correct ? 1 : 0,
              f: marking.feedback.slice(0, MAX_FEEDBACK),
              r: response.slice(0, MAX_ANSWER),
            },
          },
    );
  }

  redirect(pathFor(ref));
}

/** Clears the marking the learner has just read, and asks the next question. */
export async function continueAfterMarking(ref: CheckRef): Promise<void> {
  const cookie = await read(ref);
  const { m, ...rest } = cookie;
  if (m) await write(ref, rest);
  redirect(pathFor(ref));
}

/** The learner's own verdict on an open answer. Recorded, never counted. */
export async function submitSelfMark(
  ref: CheckRef,
  formData: FormData,
): Promise<void> {
  const cookie = await read(ref);

  if (cookie.p) {
    const { p, ...rest } = cookie;
    await write(ref, {
      ...rest,
      s: 1,
      a: [...cookie.a, { i: p.i, c: formData.get("got") === "1" ? 1 : 0 }],
    });
  }

  redirect(pathFor(ref));
}
