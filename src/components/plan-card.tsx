import Link from "next/link";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import type { PlanId } from "@/lib/billing/catalog";
import { formatDeadline } from "@/lib/goals/captured-display";
import { Card, Meta, Status, Title } from "@/components/ui";

/**
 * What this learner is on, and what it includes.
 *
 * Reads `PLAN_COPY` itself rather than taking the words as props, which keeps
 * the payload to two fields and the wording to one place. A plan's name and its
 * features are the same sentences here, on `/pricing` and on `/account/billing`
 * — three copies of them is how a plan comes to promise different things
 * depending on where you read about it.
 *
 * **It says what is true and links to what can change it.** The assistant that
 * renders this cannot cancel, upgrade or refund anything (`ASSISTANT-PLAN.md`
 * §9.2), so the card ends at the billing page rather than at a button. That is
 * not a limitation worked around; it is the shape of a read-only surface.
 */
export function PlanCard({
  planId,
  renewsOn,
}: {
  planId: PlanId;
  /**
   * The day the paid-for window ends, as `YYYY-MM-DD`, or null.
   *
   * Null on the free plan and on any account with no subscription behind it —
   * there is no date, rather than a date we are unsure of, and the card says
   * nothing instead of hedging.
   */
  renewsOn: string | null;
}) {
  const copy = PLAN_COPY[planId];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Title className="text-[length:var(--text-lead-size)]">{copy.name}</Title>
        {/* `formatDeadline` rather than `shortDate`: that one leads with a
            weekday, which is what you want against your own study week and
            noise against a billing date a month out. */}
        {renewsOn ? (
          <Status tone="neutral">Renews {formatDeadline(renewsOn)}</Status>
        ) : null}
      </div>

      <Meta>{copy.pitch}</Meta>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {copy.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
            />
            <span className="text-[length:var(--text-meta-size)] leading-[var(--text-meta-line)] text-ink">
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/account/billing"
        className="w-fit border-t border-hairline pt-3 font-[550] text-accent underline-offset-4 hover:underline"
      >
        Change or cancel it
      </Link>
    </Card>
  );
}
