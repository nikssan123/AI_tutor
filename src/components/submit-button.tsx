"use client";

import { useFormStatus } from "react-dom";
import { Button, Meta } from "@/components/ui";

/**
 * A submit button that admits its action is running.
 *
 * **JavaScript took the loading indicator away, and nothing replaced it.**
 * Every form in the product is a plain server-rendered `<form>` posting to a
 * server action, and with scripting off that is a normal navigation: the
 * browser spins its own tab throbber and the learner can see the machine
 * thinking. With scripting on — which is everybody — React posts the same form
 * over `fetch`, the browser has nothing to spin, and the page sits there
 * looking exactly as it did before the click. On a fast action nobody notices.
 * On `buildPathAction`, which is up to two model calls and a validator, the
 * report was the obvious one: "I pressed Build my path and nothing happened."
 *
 * So this is not a fifth button variant, it is the throbber the fetch stole. It
 * changes nothing about how the form posts — `useFormStatus` reads the status
 * of the form it is nested inside, and with no JavaScript to run the button
 * renders at rest and submits the ordinary way.
 *
 * Two things move, because one is not enough. The label says what is happening,
 * for anyone reading; `note` says it in a live region, for anyone whose screen
 * reader would otherwise announce nothing at all after a press. `disabled` is
 * the third, and it is doing the unglamorous work: a second click on a button
 * that costs a model call is a second model call.
 */
export function SubmitButton({
  children,
  pendingLabel,
  note,
}: {
  /** The label at rest. */
  children: React.ReactNode;
  /** The label while the action runs — what is happening, not "Loading…". */
  pendingLabel: string;
  /** One line under it, saying what the wait is for. */
  note: string;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button type="submit" disabled={pending}>
        {pending ? (
          <>
            {/* The building screen's mark for the same idea: the one thing on
                screen that is moving is the one thing that is happening.
                Reduced motion stops it at a cycle — see tokens.css. */}
            <span
              aria-hidden="true"
              className="size-2 shrink-0 animate-pulse rounded-full bg-current"
            />
            {pendingLabel}
          </>
        ) : (
          children
        )}
      </Button>

      {/* In the DOM whether or not it has anything to say: a live region added
          at the same moment as its text is a live region the screen reader was
          not yet watching, and the announcement is lost. */}
      <Meta role="status">{pending ? note : null}</Meta>
    </div>
  );
}
