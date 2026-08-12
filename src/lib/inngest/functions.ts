import { EVENTS, inngest } from "./client";

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

export const functions = [ping];
