/**
 * Vitest global setup.
 *
 * Deliberately tiny: the engine under test is pure, so there is nothing to
 * stub. The only thing worth pinning globally is the timezone — a planner that
 * behaves differently in Europe/Sofia than in UTC would be a real defect, and
 * pinning here means CI and a laptop agree.
 */
process.env.TZ = "UTC";
