import { ButtonLink, Card, Meta, Title } from "@/components/ui";
import type { Nudge } from "@/lib/billing/nudge";
import { capture } from "@/lib/observability";

/**
 * The one way this product asks somebody to pay from inside the app.
 *
 * One component so the shape is the same everywhere a wall appears, and so
 * `paywall_viewed` (§25.1) is emitted from exactly one place — an event fired
 * by four call sites is an event whose count nobody can trust.
 *
 * Deliberately a `Card` with a text button rather than anything louder. §8.5.5
 * allows one filled button per screen and it is never this one: the primary
 * action on a session screen is the session. A learner who has just been told
 * they have run out is already paying attention; shouting at them is what turns
 * a limit into a grievance.
 */
export function UpgradeNudge({ nudge }: { nudge: Nudge }) {
  capture("paywall_viewed", { trigger: nudge.reason });

  return (
    <Card className="flex flex-col items-start gap-3">
      <Title>{nudge.headline}</Title>
      <Meta>{nudge.body}</Meta>
      <ButtonLink href={nudge.href} variant="text">
        {nudge.cta}
      </ButtonLink>
    </Card>
  );
}
