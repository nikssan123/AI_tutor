import { EVENTS, inngest } from "./client";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";
import { submission as submissionTable } from "@/db/schema";
import { getAnthropic } from "@/lib/ai/client";
import { generatePack } from "@/lib/packs/generate";
import { seedPack } from "@/lib/packs/seed";
import { finishBuild } from "@/lib/packs/build";
import { evaluateSubmission } from "@/lib/evaluation";
import { entitlementsForUser } from "@/lib/billing/store";
import { subsidisesPackBuilds } from "@/lib/billing/catalog";
import { GRADER_PROMPT } from "@/lib/evaluation/grade";
import { resolvePack } from "@/lib/content/resolve";
import { masteryFor } from "@/lib/goals/store";
import { markAchievedIfComplete } from "@/lib/goals/achievement";
import { initialMastery } from "@/lib/engine/bkt";
import {
  recordEvaluation,
  setStatus,
  submissionById,
} from "@/lib/submissions/store";
import { MODELS } from "@/lib/ai/models";
import type { DomainPack } from "@/lib/packs/types";

/**
 * E1's acceptance criterion: "a trivial Inngest job runs and is traced."
 *
 * Deliberately two steps rather than one — the property worth proving is
 * durability (§14.9.5: "durable resume from the last completed step"), and a
 * single-step function proves only that the handler was invoked.
 */

export interface PingResult {
  at: string;
  message: string;
  acknowledged: boolean;
}

/** Minimal structural types, so the handler is testable without the SDK. */
export interface StepLike {
  run<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

export interface PingContext {
  event: { data?: { message?: string } };
  step: StepLike;
}

/**
 * Exported separately from the registration below so it can be tested through a
 * public API rather than by reaching into the function object's private fields.
 */
export async function pingHandler({
  event,
  step,
}: PingContext): Promise<PingResult> {
  const received = await step.run("record-receipt", () => ({
    at: new Date().toISOString(),
    message: event.data?.message ?? "ping",
  }));

  return step.run("acknowledge", () => ({
    ...received,
    acknowledged: true,
  }));
}

export const ping = inngest.createFunction(
  {
    id: "system-ping",
    name: "System ping",
    triggers: [{ event: EVENTS.ping }],
  },
  pingHandler,
);

/**
 * The registered build function, wired to the real database and model client.
 * The handler above stays injectable so the interesting half is testable.
 */
export const buildPack = inngest.createFunction(
  {
    id: "pack-build",
    name: "Build a generated pack",
    triggers: [{ event: EVENTS.buildPack }],
    // One at a time per subject: the slug is the pack, and two runs authoring
    // the same one would both pay and one would overwrite the other.
    concurrency: { key: "event.data.slug", limit: 1 },
  },
  buildPackHandler({
    generate: async ({ slug, subject, userId }) => {
      const db = getDb();

      /*
       * §14.9.7 limit 1 — the same omission that had left marking uncapped,
       * one function up.
       *
       * `generatePack` has taken a `plan` since E5 and checks the ceiling when
       * it gets one; this call never passed it, so the check was dead code and
       * a ~78¢ authoring run went out on the deep tier whatever the learner had
       * already spent. `/start` caps how many packs an account may ever
       * commission, and this is the second half: what a paying learner
       * commissions still runs inside their own ceiling.
       */
      // `userId` is null for a build nobody asked for — a script, a seed, a
      // probe. There is no ceiling to check because there is nobody to bill,
      // which is the same distinction `RunOrigin` draws.
      const plan = userId
        ? (await entitlementsForUser(db, userId, undefined)).planId
        : undefined;

      /*
       * Who this build is billed to, which is not always who asked for it.
       *
       * On a plan with a lifetime build quota the catalogue pays: the run is
       * still written to `agent_run` with its full cost, but it lands on no
       * learner's ledger and consumes no learner's ceiling. What is being paid
       * for is not that learner's consumption — it is a pack every future
       * learner on the subject reads for free, and the person who happened to
       * ask first should not be the one whose month it comes out of.
       *
       * The plan goes with the user id rather than beside it. `generatePack`
       * only reads `plan` to decide whether to degrade against the ledger, and
       * a subsidised build has no ledger to check — so it authors at full
       * quality, which is the right answer for an artefact everyone shares.
       */
      const subsidised = plan !== undefined && subsidisesPackBuilds(plan);

      const outcome = await generatePack(
        subsidised
          ? { client: getAnthropic(), db, userId: null }
          : { client: getAnthropic(), db, userId, plan },
        { slug, subject, rawGoal: null },
      );
      return { pack: outcome.pack, reasons: outcome.reasons };
    },
    seed: async (pack) => {
      await seedPack(getDb(), pack as DomainPack);
    },
    finish: async (slug, outcome) => {
      await finishBuild(getDb(), slug, outcome);
    },
  }),
);

/* ── §14.5's durable evaluate chain ───────────────────────────────────────── */

export interface EvaluateEvent {
  event: { data?: { submissionId?: string; userId?: string } };
  step: StepLike;
}

export interface EvaluateResult {
  submissionId: string;
  status: "complete" | "human_review" | "failed";
  reason: string | null;
}

/**
 * Marks a submission, off the request path.
 *
 * Two model calls at the deep tier and around a minute, which is why it cannot
 * happen in a server action. §24 E8 requires that failures "degrade gracefully:
 * queued, retried, and the user is emailed — never a silent loss", and the shape
 * here is the first half of that: a submission that cannot be marked lands in
 * `failed` with a reason attached rather than sitting in `grading` forever.
 *
 * Injected like `buildPackHandler`, so the branching is testable without a
 * database or an API key.
 */
export function evaluateHandler(deps: {
  load: (submissionId: string) => Promise<{
    userId: string;
    ok: boolean;
    reason: string | null;
  }>;
  mark: (submissionId: string, userId: string) => Promise<{
    status: "complete" | "human_review";
    reason: null;
  } | { status: "failed"; reason: string }>;
  fail: (submissionId: string, reason: string) => Promise<void>;
}) {
  return async ({ event, step }: EvaluateEvent): Promise<EvaluateResult> => {
    const submissionId = event.data?.submissionId ?? "";

    const loaded = await step.run("load-submission", () =>
      deps.load(submissionId),
    );

    if (!loaded.ok) {
      const reason = loaded.reason ?? "That submission could not be found.";
      await step.run("record-missing", () => deps.fail(submissionId, reason));
      return { submissionId, status: "failed", reason };
    }

    // The expensive half gets its own step so §14.9.5's durable resume means
    // something: a worker dying after marking must not mark again.
    const marked = await step.run("mark", () =>
      deps.mark(submissionId, loaded.userId),
    );

    if (marked.status === "failed") {
      await step.run("record-failure", () =>
        deps.fail(submissionId, marked.reason),
      );
      return { submissionId, status: "failed", reason: marked.reason };
    }

    return { submissionId, status: marked.status, reason: null };
  };
}

export const evaluate = inngest.createFunction(
  {
    id: "submission-evaluate",
    name: "Mark a submission",
    triggers: [{ event: EVENTS.evaluate }],
    concurrency: { key: "event.data.submissionId", limit: 1 },
  },
  evaluateHandler({
    load: async (submissionId) => {
      const db = getDb();
      const [row] = await db
        .select({ userId: submissionTable.userId })
        .from(submissionTable)
        .where(eq(submissionTable.id, submissionId))
        .limit(1);

      if (!row) return { userId: "", ok: false, reason: null };
      await setStatus(db, submissionId, "grading");
      return { userId: row.userId, ok: true, reason: null };
    },

    // The owner comes from the load step rather than a second query: it was
    // already established there, and re-deriving it added a branch that could
    // never be false.
    mark: async (submissionId, userId) => {
      const db = getDb();
      const stored = await submissionById(db, submissionId, userId);
      if (!stored) return { status: "failed", reason: "The submission vanished." };

      const pack = await resolvePack(db, stored.packSlug);
      const project = pack?.projects.find((p) => p.slug === stored.projectSlug);
      const rubric = pack?.rubrics.find((r) => r.slug === project?.rubric);
      const skill = pack?.skills.find((s) => s.slug === stored.skillSlug);

      if (!pack || !project || !rubric || !skill) {
        // The pack changed under a queued submission — a deployment event, not
        // a corrupt row, and the learner is told rather than left waiting.
        return {
          status: "failed",
          reason: "The brief this was handed in against is no longer available.",
        };
      }

      // §14.9.7 limit 1 had never applied to marking: this call passed no
      // `plan`, so `shouldDegrade` was skipped on the most expensive operation
      // in the product — two deep-tier calls at §20.2's measured $0.45 — and it
      // was the only AI call site outside the cap. E13 is where that closes.
      // No `user.plan` argument: that column is a cache of the two tables this
      // reads anyway, and a worker has no session to have loaded it from. With
      // neither a subscription nor a grant the resolver answers `free`, which is
      // the correct answer for someone who has neither.
      const { planId } = await entitlementsForUser(db, stored.userId, undefined);

      const outcome = await evaluateSubmission(
        { client: getAnthropic(), db, userId: stored.userId, plan: planId },
        {
          project,
          criteria: rubric.criteria,
          skillTier: skill.evalTier,
          artefact: stored.artefact,
        },
      );

      if (!outcome.result) {
        return {
          status: "failed",
          reason: outcome.reason ?? "This could not be marked.",
        };
      }

      const existing = await masteryFor(db, stored.userId, stored.packSlug);
      const mastery =
        existing.find((m) => m.skillId === skill.slug) ??
        initialMastery(skill.slug, skill.bktPriors);

      const now = new Date();

      await recordEvaluation(db, {
        submissionId,
        userId: stored.userId,
        packSlug: stored.packSlug,
        rubricSlug: rubric.slug,
        rubricVersion: rubric.version,
        skill,
        mastery,
        result: outcome.result,
        model: MODELS.deep,
        promptVersion: String(GRADER_PROMPT.version),
        now,
      });

      // A marked hand-in is the only thing that can add a skill to the ledger's
      // claims, so it is the only moment a course can become finished. §4.2
      // law 1 is why there is no button for this anywhere in the product.
      await markAchievedIfComplete(db, stored.userId, pack, now);

      return {
        status: outcome.result.humanReview ? "human_review" : "complete",
        reason: null,
      };
    },

    fail: async (submissionId, reason) => {
      const db = getDb();
      await setStatus(db, submissionId, "failed");
      void reason;
    },
  }),
);

export const functions = [ping, buildPack, evaluate];

/* ── §7.1's Generated tier ────────────────────────────────────────────────── */

export interface BuildPackEvent {
  data?: { slug?: string; subject?: string; userId?: string | null };
}

export interface BuildPackContext {
  event: BuildPackEvent;
  step: StepLike;
}

export interface BuildPackResult {
  slug: string;
  status: "ready" | "failed";
  detail: string | null;
}

/**
 * Authors a pack off the request path.
 *
 * Three model calls and about three minutes, which is why it cannot happen in a
 * server action. Two steps rather than one so §14.9.5's durable resume means
 * something here: a worker that dies after generating but before seeding must
 * not re-run the expensive half, because the expensive half is the whole cost.
 *
 * Injected rather than imported so the handler is testable without a database
 * or an API key — the same seam `pingHandler` uses.
 */
export function buildPackHandler(deps: {
  generate: (input: {
    slug: string;
    subject: string;
    userId: string | null;
  }) => Promise<{ pack: unknown | null; reasons: string[] }>;
  seed: (pack: unknown) => Promise<void>;
  finish: (
    slug: string,
    outcome: { status: "ready" } | { status: "failed"; detail: string },
  ) => Promise<void>;
}) {
  return async ({ event, step }: BuildPackContext): Promise<BuildPackResult> => {
    const slug = event.data?.slug ?? "";
    const subject = event.data?.subject ?? "";
    const userId = event.data?.userId ?? null;

    const generated = await step.run("author-pack", () =>
      deps.generate({ slug, subject, userId }),
    );

    if (generated.pack === null) {
      const detail =
        generated.reasons[0] ??
        "We could not build a good enough course for this subject.";
      await step.run("record-failure", () =>
        deps.finish(slug, { status: "failed", detail }),
      );
      return { slug, status: "failed", detail };
    }

    await step.run("seed-pack", () => deps.seed(generated.pack));
    await step.run("record-ready", () => deps.finish(slug, { status: "ready" }));

    return { slug, status: "ready", detail: null };
  };
}
