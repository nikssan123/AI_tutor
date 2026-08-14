"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findPack } from "@/lib/content";
import { gradeAuto, type DiagnosticItem } from "@/lib/engine/diagnostic";
import {
  cookieName,
  decode,
  encode,
  needsSelfMark,
  type CheckCookie,
} from "@/lib/check/session";

/**
 * The Skill Check's three transitions, as Server Actions.
 *
 * In their own module rather than inline in the page for two reasons: a "use
 * server" file can be imported and called directly by a test, and it keeps the
 * page a pure function of its cookie. Every action ends in a redirect back to
 * the same URL, so a refresh after answering re-renders the next question
 * instead of resubmitting the last one.
 */

const SIX_HOURS = 60 * 60 * 6;

async function write(topic: string, next: CheckCookie): Promise<void> {
  const jar = await cookies();
  jar.set(cookieName(topic), encode(next), {
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

async function read(topic: string): Promise<CheckCookie> {
  const jar = await cookies();
  return decode(jar.get(cookieName(topic))?.value);
}

function itemsFor(topic: string): DiagnosticItem[] {
  const pack = findPack(topic);
  if (!pack) return [];
  return pack.items.map((i) => ({
    slug: i.slug,
    skill: i.skill,
    type: i.type,
    difficulty: i.difficulty,
    discrimination: i.discrimination,
    prompt: i.prompt,
    options: i.options,
    answerKey: i.answerKey,
  }));
}

/** Starts a check, and restarts a finished one — the same thing. */
export async function startCheck(topic: string): Promise<void> {
  await write(topic, { s: 1, a: [] });
  redirect(`/check/${topic}`);
}

/**
 * One answer. A closed item is graded here; an open one is parked as `pending`
 * so the next screen can reveal the key and let the learner mark themselves,
 * which the engine records as Tier 5 and therefore never counts as mastery.
 */
export async function submitAnswer(
  topic: string,
  formData: FormData,
): Promise<void> {
  const cookie = await read(topic);
  const slug = String(formData.get("item") ?? "");
  const item = itemsFor(topic).find((i) => i.slug === slug);

  // A stale or forged form is dropped rather than recorded against the wrong
  // item — the check would rather ask again than log a fiction.
  if (item) {
    const response = String(formData.get("response") ?? "");
    await write(
      topic,
      needsSelfMark(item)
        ? { ...cookie, p: { i: item.slug, r: response } }
        : {
            ...cookie,
            a: [
              ...cookie.a,
              { i: item.slug, c: gradeAuto(item, response) ? 1 : 0 },
            ],
          },
    );
  }

  redirect(`/check/${topic}`);
}

/** The learner's own verdict on an open answer. Recorded, never counted. */
export async function submitSelfMark(
  topic: string,
  formData: FormData,
): Promise<void> {
  const cookie = await read(topic);

  if (cookie.p) {
    const { p, ...rest } = cookie;
    await write(topic, {
      ...rest,
      s: 1,
      a: [...cookie.a, { i: p.i, c: formData.get("got") === "1" ? 1 : 0 }],
    });
  }

  redirect(`/check/${topic}`);
}
