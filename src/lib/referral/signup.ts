import { cookies, headers } from "next/headers";
import { getDb } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import { REFERRAL_COOKIE } from "./cookie";
import { attribute } from "./store";

/**
 * The Better Auth `user.create.after` hook, as a function — §9.1.
 *
 * Extracted from `src/lib/auth.ts` rather than written inline for the reason
 * `AGENTS.md` gives about untestable lines: a hook buried in a config object
 * cannot be called from a test without standing up the whole auth instance, and
 * a branch no test can reach is a design problem rather than a coverage one.
 *
 * **It never throws.** A referral that cannot be recorded is a missed reward; a
 * hook that throws is a signup that failed, and nobody trades the second for
 * the first. Everything here is inside one try.
 */

/** Only meaningful in development; production always sets a real one. */
export const DEV_PEPPER = "meritkeep-dev-pepper";

export async function attributeSignup(
  created: { id: string; email: string },
  env: EnvLike = process.env,
): Promise<void> {
  try {
    const jar = await cookies();
    const code = jar.get(REFERRAL_COOKIE)?.value;
    if (!code) return;

    const headerBag = await headers();

    await attribute(getDb(), {
      code,
      referee: { userId: created.id, email: created.email },
      // The first entry is the client; the rest are proxies that added
      // themselves. Only the first is a signal about the person.
      ip: headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerBag.get("user-agent"),
      pepper: env.REFERRAL_PEPPER ?? DEV_PEPPER,
    });

    // Spent. Leaving it would attribute a second account on the same browser
    // to the same referrer, which is the thing §9.3 exists to prevent.
    jar.delete(REFERRAL_COOKIE);
  } catch (error) {
    console.error("[referral] could not attribute a signup:", error);
  }
}
