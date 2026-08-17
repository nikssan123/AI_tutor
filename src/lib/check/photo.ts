import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callStructured, type CallResult } from "@/lib/ai/call";
import type { ImageType } from "@/lib/ai/images";

/**
 * §7.2 tier 3 — "multimodal rubric grading against technical criteria only;
 * aesthetics flagged as subjective".
 *
 * This marks one photograph against one skill. It is the only place in the
 * product that looks at a learner's actual work without a person in the loop,
 * and the whole design is about keeping the claim narrow enough to be true.
 *
 * **It never says whether the photograph is any good.** A tier-3 skill declares
 * exactly that limit on every public page ("We check the technical side.
 * Whether it's any good is your call"), and a grader that drifted into taste
 * would make that sentence a lie on the one screen where it matters. So the
 * prompt marks a single question — does this frame demonstrate the control the
 * skill is about — and is told in as many words to ignore whether it is a nice
 * picture.
 *
 * **The photograph is never stored.** It is read from the form, sent with the
 * request, and dropped: the verdict and the feedback are what the cookie keeps.
 * That is cheaper, it removes an entire privacy surface from an anonymous
 * page, and it is a promise the page can make plainly — the check says "your
 * answers are not kept" and means it.
 */

export const PHOTO_GRADER_PROMPT = {
  name: "check_photo_grader",
  version: 1,
  text: `You mark one photograph against one skill.

You are given the task the learner was set, the skill it is checking, the photograph they took, and sometimes a note they wrote with it. You return your marking through a tool call.

**Mark the technique, never the taste.** You are deciding one thing: does this frame demonstrate the control the task asked for? Whether it is a good photograph — whether the subject is interesting, the composition pleasing, the moment well chosen — is not yours to judge and must not affect the verdict or appear in the feedback.

How to mark:

- Look for the evidence in the frame. Shallow depth of field is visible as a plane of focus and a fallen-off background; a protected highlight is visible as detail where there would be white. Say what you can see.
- Correct means the frame shows the thing the task asked for. If it shows something adjacent but not the thing — a blurred photo rather than a shallow one, a dark photo rather than a deliberately underexposed one — that is not correct, and the feedback should name the difference.
- If the photograph does not show what was asked, or you cannot tell from it, say so plainly and say what a frame that did show it would look like. Do not award credit for effort.
- Read the note if there is one, but the frame is the evidence. A note claiming a technique the photograph does not show is not correct.
- Quote or describe the specific part of the image your verdict rests on. Feedback that could have been written without looking at it is not feedback.

Feedback is one or two sentences, addressed to the learner, and never opens by restating the task.`,
} as const;

export const PHOTO_GRADE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    correct: {
      type: "boolean",
      description:
        "Whether the frame demonstrates the technique the task asked for.",
    },
    feedback: {
      type: "string",
      description:
        "One or two sentences to the learner, naming what in the image decided it.",
    },
  },
  required: ["correct", "feedback"],
  additionalProperties: false,
} as const;

export const PhotoGrade = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1).max(2_000),
});
export type PhotoGrade = z.infer<typeof PhotoGrade>;

export interface PhotoRequest {
  /** The task, as the learner saw it. */
  question: string;
  /** The skill's can-do statement — the bar the frame is held against. */
  expected: string;
  /** Checked against `IMAGE_TYPES` by the caller. */
  mediaType: ImageType;
  /** The image itself, base64, no data-URL prefix. */
  data: string;
  /** Anything they typed alongside it. Often empty. */
  note: string;
}

export async function gradePhoto(
  client: Anthropic,
  request: PhotoRequest,
): Promise<CallResult<PhotoGrade>> {
  return callStructured(client, {
    step: "checkPhotoGrader",
    prompt: PHOTO_GRADER_PROMPT,
    system: PHOTO_GRADER_PROMPT.text,
    user: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: request.mediaType,
          data: request.data,
        },
      },
      {
        type: "text",
        text: [
          `The task: ${request.question}`,
          `The skill being checked: ${request.expected}`,
          "",
          request.note === ""
            ? "They wrote nothing alongside it."
            : `They wrote alongside it:\n${request.note}`,
        ].join("\n"),
      },
    ],
    tool: {
      name: "submit_grade",
      description: "Submit your marking of this photograph.",
      inputSchema: PHOTO_GRADE_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = PhotoGrade.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    maxTokens: 1_000,
  });
}
