import Link from "next/link";
import type { Digest } from "@/lib/mastery/digest";
import { Card, Lead, Meta, Title } from "@/components/ui";
import { ArrowIcon } from "@/components/icons";

/**
 * The week in two cards: what moved, and what is slipping.
 *
 * Pulled out of `/progress` for the reason given in `ASSISTANT-PLAN.md` §6 — a
 * learner is about to be able to ask "how am I doing" somewhere other than this
 * screen, and the answer has to be the same object, not a second description of
 * it. Both halves are claims about evidence, and two places wording them
 * separately is how they come to disagree.
 *
 * No percentage anywhere (§24 E9), and nothing here says a skill is *held* —
 * `moved` is the ledger's own list, and "starting to slip" is decay, not a
 * verdict on the learner.
 */
export function WeekDigest({ digest }: { digest: Digest }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card className="flex h-full flex-col gap-4">
        <Title>What changed</Title>
        {digest.moved.length > 0 ? (
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {digest.moved.map((move) => (
              <li key={move.name} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
                />
                {move.name}
              </li>
            ))}
          </ul>
        ) : (
          <Meta tone="muted">
            Nothing moved. Mastery only moves on work we can mark.
          </Meta>
        )}
        <Meta className="mt-auto border-t border-hairline pt-4">
          {digest.artefacts > 0
            ? `${digest.artefacts} ${digest.artefacts === 1 ? "piece" : "pieces"} of work handed in`
            : "Nothing handed in"}
        </Meta>
      </Card>

      <Card className="flex h-full flex-col gap-4">
        <Title>Holding on to it</Title>
        {digest.tracked > 0 ? (
          <>
            <Lead className="text-ink">
              {digest.tracked} {digest.tracked === 1 ? "skill" : "skills"} you
              have shown.{" "}
              {digest.slipping > 0
                ? `${digest.slipping} of them ${digest.slipping === 1 ? "is" : "are"} starting to slip.`
                : "None of them are slipping."}
            </Lead>
            {digest.slipping > 0 ? (
              <Link
                href="/mastery?show=left"
                className="mt-auto inline-flex w-fit items-center gap-1.5 font-[550] text-accent underline-offset-4 hover:underline"
              >
                See which
                <ArrowIcon className="size-4" />
              </Link>
            ) : null}
          </>
        ) : (
          <Meta tone="muted">
            Nothing to hold on to yet — this fills up as you show what you can
            do.
          </Meta>
        )}
      </Card>
    </div>
  );
}
