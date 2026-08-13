import { describe, expect, it } from "vitest";
import { degrade, MODELS, STEP_MODELS } from "@/lib/ai/models";

describe("§14.8 — model routing", () => {
  it("pins the exact API ids, not friendly names", () => {
    expect(MODELS).toEqual({
      fast: "claude-haiku-4-5",
      standard: "claude-sonnet-5",
      deep: "claude-opus-5",
    });
  });

  it("routes only the steps that earn it to the deep tier", () => {
    /*
     * §14.8: "never default everything to Opus". The crown jewel and the
     * anti-mediocrity gate earn it, and so does authoring a generated pack's
     * skill graph — §7.1's Generated tier is written once and then read by the
     * diagnostic, the planner and the curriculum, none of which can correct it.
     * The item bank and the rubrics for the same pack stay on standard.
     */
    const deep = Object.entries(STEP_MODELS)
      .filter(([, tier]) => tier === "deep")
      .map(([step]) => step)
      .sort();
    expect(deep).toEqual([
      "consistencyPass",
      "curriculumValidator",
      "packAuthor",
      "rubricGrader",
    ]);
    expect(STEP_MODELS.packItems).toBe("standard");
    expect(STEP_MODELS.packRubrics).toBe("standard");
  });

  it("keeps the cheap classification steps on the fast tier", () => {
    expect(STEP_MODELS.artifactIngestor).toBe("fast");
    expect(STEP_MODELS.coherenceCheck).toBe("fast");
  });

  it("degrades deep to standard, and leaves the rest alone", () => {
    // §14.9.7 — degrade before queueing, queue before notifying.
    expect(degrade("deep")).toBe("standard");
    expect(degrade("standard")).toBe("standard");
    expect(degrade("fast")).toBe("fast");
  });
});
