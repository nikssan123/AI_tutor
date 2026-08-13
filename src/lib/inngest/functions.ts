import { EVENTS, inngest } from "./client";
import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { generatePack } from "@/lib/packs/generate";
import { seedPack } from "@/lib/packs/seed";
import { finishBuild } from "@/lib/packs/build";
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
      const outcome = await generatePack(
        { client: getAnthropic(), db: getDb(), userId },
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

export const functions = [ping, buildPack];

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
