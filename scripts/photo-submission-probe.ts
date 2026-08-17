import sharp from "sharp";
import { createClient } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { findPack } from "@/lib/content";
import { evaluateSubmission } from "@/lib/evaluation";
import { acceptImages } from "@/lib/submissions/images";
import { createSubmission, submissionById } from "@/lib/submissions/store";
import { user as userTable } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * §24 E8.5 — a photograph handed in, stored, and marked, against the real API.
 *
 * The unit tests stub the model, and both defects that actually reached a
 * learner in E8 passed every unit test on the way past. This drives the half a
 * stub cannot: that the image survives `acceptImages`, round-trips through the
 * `artifact` rows as base64, arrives at Anthropic as a content block it accepts,
 * and comes back as bands the verifier upholds.
 *
 * **What it does not prove.** The frames are generated, not photographed, so
 * nothing here says the grading is any *good* — only that the loop closes and
 * the verdict is anchored in the learner's own words. It costs two deep-tier
 * calls, around $0.10.
 *
 *   pnpm tsx scripts/photo-submission-probe.ts
 */

const USER_ID = "photo-probe-user";
const PACK = "photography";
const PROJECT = "exposure-under-control";

/**
 * Four frames of one scene at four exposures.
 *
 * Generated rather than photographed, and chosen because it is the one thing a
 * synthetic image can honestly demonstrate: the brief asks for "correctly
 * exposed, one stop under, one stop over", and a stop is a factor of two in
 * light. A grader can check that from pixels alone, which is exactly what the
 * `exposure-intent` and `repeatability` criteria ask it to do.
 */
async function frames(): Promise<Buffer[]> {
  const scene = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 400,
            height: 800,
            channels: 3,
            background: { r: 235, g: 235, b: 230 },
          },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
      {
        input: await sharp({
          create: {
            width: 400,
            height: 800,
            channels: 3,
            background: { r: 26, g: 26, b: 30 },
          },
        })
          .png()
          .toBuffer(),
        left: 800,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  // 1.0 is the reference; a stop is a doubling, so 0.5 and 2.0 are ±1 stop.
  return Promise.all(
    [1, 0.5, 2, 1.7].map((multiplier) =>
      sharp(scene).modulate({ brightness: multiplier }).jpeg({ quality: 85 }).toBuffer(),
    ),
  );
}

const METHOD = `Four frames of the same three-zone scene: a near-white panel on the left, mid-grey through the middle, a near-black panel on the right. Tripod, no reframing between frames, so the only variable is exposure.

Frame 1 is the reference. I metered off the mid-grey centre and exposed for it, which puts the white panel just below clipping and keeps detail in the black panel.

Frame 2 is deliberately one stop under the reference — half the light. I did this by halving the shutter time rather than closing the aperture, so depth of field is identical across the set and the only difference is exposure.

Frame 3 is deliberately one stop over the reference — double the light. The white panel is at the edge of what it can hold here, and that is intentional rather than a mistake: the point of the frame is to show the top end being pushed, not to make a nice picture.

Frame 4 is the override. Metering across a frame this contrasty pulls the reading towards the black panel and the camera wants to open up, which would blow the white panel entirely. I applied about +0.75 stop of compensation from the frame-2 reading instead of accepting what the meter asked for, because the meter is averaging a scene that is not average.

Across the set the framing, focus distance and aperture are unchanged, so the difference between frames is exposure alone and nothing else.`;

async function main() {
  const { db, close } = createClient(process.env.DATABASE_URL!, 2);
  const now = new Date();

  const pack = findPack(PACK)!;
  const project = pack.projects.find((p) => p.slug === PROJECT)!;
  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;
  const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;

  console.log(`brief:    ${project.title}`);
  console.log(
    `evidence: ${project.evidence.image}, up to ${project.evidence.images}`,
  );
  console.log(
    `rubric:   ${rubric.slug} — ${rubric.criteria
      .map((c) => `${c.id}:${c.marks}`)
      .join(" ")}`,
  );

  await db.delete(userTable).where(eq(userTable.id, USER_ID));
  await db.insert(userTable).values({
    id: USER_ID,
    name: "Photo Probe",
    email: "photo-probe@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  // Exactly what the browser sends: `File` objects out of a multipart form.
  const buffers = await frames();
  const files = buffers.map(
    (bytes, i) => new File([new Uint8Array(bytes)], `frame-${i + 1}.jpg`, { type: "image/jpeg" }),
  );
  console.log(
    `\nframes:   ${files.map((f) => `${Math.round(f.size / 1024)}KB`).join(", ")}`,
  );

  const { images, refused } = await acceptImages(files, project.evidence);
  if (refused) {
    console.log(`REFUSED at ingest: ${refused}`);
    await close();
    return;
  }
  console.log(`accepted: ${images.length} images`);

  const submissionId = await createSubmission(db, {
    userId: USER_ID,
    packSlug: PACK,
    projectSlug: project.slug,
    artefact: METHOD,
    truncated: false,
    images,
    skillSlug: skill.slug,
    now,
  });

  // Read back rather than reusing what we just built: the round trip through
  // `artifact` rows is the part with somewhere to go wrong.
  const stored = await submissionById(db, submissionId, USER_ID);
  console.log(
    `stored:   ${stored!.images.length} images back out, ${stored!.images
      .map((i) => i.mediaType)
      .join(" ")}`,
  );

  console.log("\nmarking against the real API…");
  const outcome = await evaluateSubmission(
    { client: getAnthropic(), db, userId: null, origin: "operator" },
    {
      project,
      criteria: rubric.criteria,
      skillTier: skill.evalTier,
      artefact: stored!.artefact,
      images: stored!.images,
    },
  );

  if (!outcome.result) {
    console.log(`NOT MARKED: ${outcome.reason} (${outcome.cause})`);
    console.log(outcome.detail ?? "");
    await close();
    return;
  }

  const { result } = outcome;
  console.log(
    `\nverdict:  ${Math.round(result.overall * 100)}% · confidence ${result.confidence.toFixed(2)} · tier ${result.evalTier}`,
  );
  console.log(
    `verifier: ${result.verification.passed ? "clean" : "not clean"} · ${result.criteria.length} upheld · ${result.verification.invalidated.length} thrown out · spread ${result.bandSpread ?? "n/a"}`,
  );

  for (const criterion of result.criteria) {
    console.log(`\n  ${criterion.criterionId} — ${criterion.band} (${criterion.marks})`);
    if (criterion.evidence) {
      console.log(`    quoted: "${criterion.evidence.slice(0, 90)}…"`);
    }
    // §24 E8.5 phase 2 — the half no string match can settle, printed so that a
    // run of this probe shows whether the grader pointed at a real frame.
    if (criterion.locator) {
      const { photograph, where, observed } = criterion.locator;
      console.log(`    photo ${photograph}, ${where}: ${observed.slice(0, 90)}`);
    }
    console.log(`    ${criterion.reasoning}`);
  }

  for (const bad of result.verification.invalidated) {
    console.log(`\n  THROWN OUT ${bad.criterionId}: ${bad.reason}`);
  }

  await close();
}

void main();
