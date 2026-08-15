import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { AudienceSchema, type Audience } from "./types";

/**
 * Reads audience pages from disk — one file per page, in git, reviewed in a
 * diff. Identical in shape to `guides/loader.ts` and for the identical reason:
 * the unit of review is the unit of storage, and a database row is not a thing
 * anybody reads in a pull request.
 */

export const AUDIENCES_DIR = join("content", "audiences");

export class AudienceParseError extends Error {
  constructor(file: string, detail: string) {
    super(`Failed to parse ${file}: ${detail}`);
    this.name = "AudienceParseError";
  }
}

export function loadAudience(path: string): Audience {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new AudienceParseError(path, "file not found");
  }

  let document: unknown;
  try {
    document = parse(raw);
  } catch (error) {
    throw new AudienceParseError(path, (error as Error).message);
  }

  const result = AudienceSchema.safeParse(document);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AudienceParseError(path, detail);
  }

  // The filename is the URL, as it is for a guide.
  const expected = `${result.data.slug}.yaml`;
  if (basename(path) !== expected) {
    throw new AudienceParseError(path, `slug requires the filename ${expected}`);
  }

  return result.data;
}

export function loadAllAudiences(root = AUDIENCES_DIR): Audience[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => loadAudience(join(root, name)));
}
