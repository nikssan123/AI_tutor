import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { GuideSchema, type Guide } from "./types";

/**
 * Reads guides from disk.
 *
 * One file per guide rather than a directory per guide, which is where this
 * differs from `packs/loader.ts` and for a reason: a pack is four kinds of
 * thing a reviewer reads separately, and a guide is one piece of writing. The
 * unit of review is the unit of storage in both cases.
 */

export const GUIDES_DIR = join("content", "guides");

export class GuideParseError extends Error {
  constructor(file: string, detail: string) {
    super(`Failed to parse ${file}: ${detail}`);
    this.name = "GuideParseError";
  }
}

export function loadGuide(path: string): Guide {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new GuideParseError(path, "file not found");
  }

  let document: unknown;
  try {
    document = parse(raw);
  } catch (error) {
    throw new GuideParseError(path, (error as Error).message);
  }

  const result = GuideSchema.safeParse(document);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new GuideParseError(path, detail);
  }

  // The filename is the URL. Letting them differ would mean a guide whose file
  // you cannot find from its address, which is the thing that makes a content
  // directory unmaintainable at fifty pages.
  const expected = `${result.data.slug}.yaml`;
  if (basename(path) !== expected) {
    throw new GuideParseError(path, `slug requires the filename ${expected}`);
  }

  return result.data;
}

export function loadAllGuides(root = GUIDES_DIR): Guide[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => loadGuide(join(root, name)));
}
