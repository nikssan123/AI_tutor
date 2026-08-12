/**
 * A partial view of the environment.
 *
 * Next.js augments `NodeJS.ProcessEnv` to make `NODE_ENV` required, which means
 * any function typed against it cannot be called with a partial object — and
 * partial objects are exactly what makes environment-dependent behaviour
 * testable without mutating global state.
 */
export type EnvLike = Record<string, string | undefined>;
