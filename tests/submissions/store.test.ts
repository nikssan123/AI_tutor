import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import {
  artifact,
  evaluation,
  learnerSkillMastery,
  masteryUpdate,
  submission,
  user,
} from "@/db/schema";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { skillId } from "@/lib/packs/ids";
import { initialMastery } from "@/lib/engine/bkt";
import {
  createSubmission,
  evaluationFor,
  recordEvaluation,
  setFailed,
  setStatus,
  submissionById,
} from "@/lib/submissions/store";
import type { GradedResult } from "@/lib/evaluation";
import type { SubmittedImage } from "@/lib/submissions/images";

/**
 * §15's audit trail: "every mastery change is traceable to evidence".
 *
 * The property worth defending is that an evaluation and the mastery it moves
 * land together or not at all — a mastery row whose evaluation failed to write
 * is exactly the untraceable change §4.2 law 1 exists to prevent.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const IDS = ["submission-test-user"];
const NOW = new Date("2026-08-13T12:00:00.000Z");
const PACK = "photography";

const result = (over: Partial<GradedResult> = {}): GradedResult => ({
  overall: 0.75,
  confidence: 0.8,
  evalTier: 2,
  verification: {
    upheld: [],
    invalidated: [],
    missing: [],
    passed: true,
    quotedWeight: 1,
    located: [],
  },
  criteria: [
    {
      criterionId: "framing",
      name: "Framing",
      band: "strong",
      evidence: "the horizon sits on the lower third",
      locator: null,
      marks: "text",
      reasoning: "you placed it deliberately",
      weight: 1,
    },
  ],
  strengths: ["good instinct for light"],
  gaps: ["no consideration of the background"],
  nextActions: ["reshoot with the background in mind"],
  bandSpread: 0,
  humanReview: false,
  observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
  ...over,
});

live("submissions", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = loadPack(`packs/${PACK}`);
  const skill = pack.skills[0]!;
  const project = pack.projects[0]!;
  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, IDS));
    await close();
  });

  beforeEach(async () => {
    await db.delete(user).where(inArray(user.id, IDS));
    await db.insert(user).values({
      id: IDS[0]!,
      name: "Submitter",
      email: "submitter@example.com",
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await seedPack(db, pack);
  });

  const create = (images?: SubmittedImage[]) =>
    createSubmission(db, {
      userId: IDS[0]!,
      packSlug: PACK,
      projectSlug: project.slug,
      artefact: "the horizon sits on the lower third of the frame",
      truncated: false,
      ...(images ? { images } : {}),
      skillSlug: skill.slug,
      now: NOW,
    });

  const frame = (data: string): SubmittedImage => ({
    mediaType: "image/jpeg",
    data,
    bytes: data.length,
  });

  it("stores the work and what it was handed in against", async () => {
    const id = await create();
    const stored = await submissionById(db, id, IDS[0]!);

    expect(stored).toMatchObject({
      packSlug: PACK,
      projectSlug: project.slug,
      skillSlug: skill.slug,
      status: "queued",
      truncated: false,
    });
    expect(stored!.artefact).toContain("lower third");
  });

  /**
   * §24 E8.5 — a hand-in is several `artifact` rows now: one written method and
   * up to six photographs. `submissionById` used to `limit(1)` an inner join,
   * which was right exactly while a submission could only ever be one row.
   */
  describe("the photographs stored with it", () => {
    it("round-trips them in the order they were handed in", async () => {
      const id = await create([frame("QUFB"), frame("QkJC"), frame("Q0ND")]);
      const stored = await submissionById(db, id, IDS[0]!);

      expect(stored!.images.map((i) => i.data)).toEqual(["QUFB", "QkJC", "Q0ND"]);
      expect(stored!.images[0]!.mediaType).toBe("image/jpeg");
      expect(stored!.images[0]!.bytes).toBe(4);
    });

    it("still finds the write-up, which is the row the metadata rides on", async () => {
      const id = await create([frame("QUFB")]);
      const stored = await submissionById(db, id, IDS[0]!);

      expect(stored!.artefact).toContain("lower third");
      expect(stored!.projectSlug).toBe(project.slug);
    });

    it("is empty for a written-only hand-in", async () => {
      const stored = await submissionById(db, await create(), IDS[0]!);
      expect(stored!.images).toEqual([]);
    });

    it("drops an image row carrying no metadata at all", async () => {
      // No media type means nothing to tell the API the bytes are a JPEG.
      const id = await create([frame("QUFB")]);
      await db
        .update(artifact)
        .set({ metadata: null })
        .where(and(eq(artifact.submissionId, id), eq(artifact.type, "image")));

      const stored = await submissionById(db, id, IDS[0]!);
      expect(stored!.images).toEqual([]);
    });

    it("reads a row with no size or order as zero of both", async () => {
      // `sizeBytes` is nullable and `index` is ours; a row written by a future
      // deployment that omits either is still a photograph we can send.
      const id = await create([frame("QUFB")]);
      await db
        .update(artifact)
        .set({ sizeBytes: null, metadata: { mediaType: "image/png" } })
        .where(and(eq(artifact.submissionId, id), eq(artifact.type, "image")));

      const stored = await submissionById(db, id, IDS[0]!);
      expect(stored!.images).toEqual([
        { mediaType: "image/png", data: "QUFB", bytes: 0 },
      ]);
    });

    it("drops an image row whose media type the API no longer takes", async () => {
      // Sending it anyway fails the whole marking rather than one photograph,
      // and the written method is still markable without it.
      const id = await create([frame("QUFB")]);
      await db
        .update(artifact)
        .set({ metadata: { mediaType: "image/heic", index: 0 } })
        // Scoped to the image row: the write-up beside it carries the metadata
        // that says which brief this answers, and overwriting that makes the
        // whole submission unreadable rather than one photograph.
        .where(and(eq(artifact.submissionId, id), eq(artifact.type, "image")));

      const stored = await submissionById(db, id, IDS[0]!);
      expect(stored!.images).toEqual([]);
      expect(stored!.artefact).toContain("lower third");
    });
  });

  it("will not hand someone else's marked work to a guessed UUID", async () => {
    const id = await create();
    expect(await submissionById(db, id, "someone-else")).toBeUndefined();
  });

  it("returns nothing for a submission that does not exist", async () => {
    expect(
      await submissionById(db, crypto.randomUUID(), IDS[0]!),
    ).toBeUndefined();
  });

  it("moves through its statuses", async () => {
    const id = await create();
    await setStatus(db, id, "grading");
    expect((await submissionById(db, id, IDS[0]!))!.status).toBe("grading");
  });

  describe("setFailed", () => {
    /*
     * The status and the reason in one write, which is why this is not an
     * optional argument on `setStatus`. A row that says `failed` and cannot say
     * why is a row the screen would render as the generic apology, and for the
     * moment between two writes that is exactly what a learner reloading would
     * have seen.
     */
    it("records the cause with the status", async () => {
      const id = await create();
      await setFailed(db, id, "brief_gone", "missing for photography: project p1");

      const stored = (await submissionById(db, id, IDS[0]!))!;
      expect(stored.status).toBe("failed");
      expect(stored.failureCause).toBe("brief_gone");
    });

    it("is null on everything that has not failed", async () => {
      // Every row written before the column existed reads this way too, which
      // is the case `failureCopy` treats as ordinary rather than as an error.
      const id = await create();
      expect((await submissionById(db, id, IDS[0]!))!.failureCause).toBeNull();
    });

    it("keeps the detail off the shape the screen reads", async () => {
      // `failure_detail` is ours. It is stored, and it is deliberately not on
      // `SubmissionDetail`, so no screen can render it by reaching for it.
      const id = await create();
      await setFailed(db, id, "marker_unavailable", "gaps: Too big");

      const stored = (await submissionById(db, id, IDS[0]!))!;
      expect(stored).not.toHaveProperty("failureDetail");

      const [row] = await db
        .select({ detail: submission.failureDetail })
        .from(submission)
        .where(eq(submission.id, id));
      expect(row!.detail).toBe("gaps: Too big");
    });
  });

  describe("recording an evaluation", () => {
    const record = (over: Partial<GradedResult> = {}) =>
      create().then(async (id) => {
        const outcome = await recordEvaluation(db, {
          submissionId: id,
          userId: IDS[0]!,
          packSlug: PACK,
          rubricSlug: rubric.slug,
          rubricVersion: rubric.version,
          skill,
          mastery: initialMastery(skill.slug, skill.bktPriors),
          result: result(over),
          model: "claude-opus-5",
          promptVersion: "1",
          now: NOW,
        });
        return { id, outcome };
      });

    it("writes the evaluation with its evidence intact", async () => {
      const { id } = await record();
      const view = (await evaluationFor(db, id))!;

      expect(view.overall).toBeCloseTo(0.75);
      expect(view.verifierPassed).toBe(true);
      expect(view.criteria[0]).toMatchObject({
        name: "Framing",
        band: "strong",
        evidence: "the horizon sits on the lower third",
      });
    });

    it("moves mastery and leaves the trail back to the evidence", async () => {
      const { id, outcome } = await record();

      const [update] = await db
        .select()
        .from(masteryUpdate)
        .where(eq(masteryUpdate.evaluationId, outcome.evaluationId));

      expect(update).toBeDefined();
      expect(update!.posteriorMastery).toBeGreaterThan(update!.priorMastery);
      // The sentence a learner would be shown if they asked why it moved.
      expect(update!.reason).toContain("75%");

      const [held] = await db
        .select()
        .from(learnerSkillMastery)
        .where(
          and(
            eq(learnerSkillMastery.userId, IDS[0]!),
            eq(learnerSkillMastery.skillId, skillId(PACK, skill.slug)),
          ),
        );
      expect(held!.mastery).toBeGreaterThan(0);

      expect((await submissionById(db, id, IDS[0]!))!.status).toBe("complete");
    });

    it("logs tier-5 work as engagement without moving mastery (§7.2)", async () => {
      const { outcome } = await record({
        evalTier: 5,
        confidence: 0,
        observation: { correct: true, confidence: 0, evidenceTier: 5 },
      });

      expect(outcome.masteryDelta).toBeNull();

      const [update] = await db
        .select()
        .from(masteryUpdate)
        .where(eq(masteryUpdate.evaluationId, outcome.evaluationId));
      expect(update!.delta).toBe(0);
      expect(update!.reason).toContain("cannot raise mastery");
    });

    it("parks a disputed-looking verdict for a person", async () => {
      const { id } = await record({ humanReview: true, bandSpread: 3 });
      expect((await submissionById(db, id, IDS[0]!))!.status).toBe(
        "human_review",
      );
    });

    it("keeps what the verifier threw out beside the score", async () => {
      // §14.5 — the log is the moat, and a score without its caveats is a
      // number nobody can audit later.
      const { outcome } = await record({
        verification: {
          upheld: [],
          invalidated: [{ criterionId: "sharpness", reason: "not in the work" }],
          missing: ["exposure"],
          passed: false,
          quotedWeight: 1,
          located: [{ criterionId: "framing", photographs: [2] }],
        },
      });
      expect(outcome.evaluationId).toBeDefined();
    });

    it("records work that fell short, and a run with no second pass", async () => {
      // Nothing to compare against, and nothing succeeded — so no band spread
      // is stored and the retention clock is not started.
      const { outcome } = await record({
        overall: 0.2,
        bandSpread: undefined,
        observation: { correct: false, confidence: 0.7, evidenceTier: 2 },
      });

      const [update] = await db
        .select()
        .from(masteryUpdate)
        .where(eq(masteryUpdate.evaluationId, outcome.evaluationId));
      // Not a drop: §16.2's `pLearn` moves the belief a little even when the
      // attempt failed, because attempting it is itself practice. What must not
      // happen is the retention clock starting.
      expect(update!.evidenceTier).toBe(2);

      // Scoped to this test's learner. Mastery is keyed on (user, skill), and
      // a predicate on the skill alone reads whoever else's row happens to be
      // in the shared database — a fixture for another screen was enough to
      // fail this on a fact about a different person.
      const [held] = await db
        .select()
        .from(learnerSkillMastery)
        .where(
          and(
            eq(learnerSkillMastery.userId, IDS[0]!),
            eq(learnerSkillMastery.skillId, skillId(PACK, skill.slug)),
          ),
        );
      expect(held!.lastSuccessAt).toBeNull();
    });

    it("returns nothing for a submission with no evaluation yet", async () => {
      const id = await create();
      expect(await evaluationFor(db, id)).toBeUndefined();
    });
  });

  it("reports a submission whose artefact metadata is unreadable as absent", async () => {
    // Metadata says which brief the work answers. Without it there is nothing
    // to mark against, so the row is absent rather than half-read.
    const id = await create();
    await db
      .update(artifact)
      .set({ metadata: { nonsense: true } })
      .where(eq(artifact.submissionId, id));

    expect(await submissionById(db, id, IDS[0]!)).toBeUndefined();
  });

  it("reports a submission with no metadata at all as absent", async () => {
    const id = await create();
    await db
      .update(artifact)
      .set({ metadata: null })
      .where(eq(artifact.submissionId, id));

    expect(await submissionById(db, id, IDS[0]!)).toBeUndefined();
  });

  it("treats an unrecognised status as still queued", async () => {
    const id = await create();
    await db
      .update(submission)
      .set({ status: "something-new" })
      .where(eq(submission.id, id));

    expect((await submissionById(db, id, IDS[0]!))!.status).toBe("queued");
  });

  it("survives an evaluation whose lists were stored as something else", async () => {
    const id = await create();
    await recordEvaluation(db, {
      submissionId: id,
      userId: IDS[0]!,
      packSlug: PACK,
      rubricSlug: rubric.slug,
      rubricVersion: rubric.version,
      skill,
      mastery: initialMastery(skill.slug, skill.bktPriors),
      result: result(),
      model: "claude-opus-5",
      promptVersion: "1",
      now: NOW,
    });

    await db
      .update(evaluation)
      .set({ strengths: "not a list", gaps: [1, "keep"], criterionResults: "no" })
      .where(eq(evaluation.submissionId, id));

    const view = (await evaluationFor(db, id))!;
    expect(view.strengths).toEqual([]);
    expect(view.gaps).toEqual(["keep"]);
    expect(view.criteria).toEqual([]);
  });

  it("keeps every status it recognises", async () => {
    // Metadata is what says which brief the work answers; without it there is
    // nothing to mark against, and the row is reported absent rather than half-read.
    const id = await create();
    await db
      .update(submission)
      .set({ status: "queued" })
      .where(eq(submission.id, id));

    const stored = await submissionById(db, id, IDS[0]!);
    expect(stored).toBeDefined();
  });
});
