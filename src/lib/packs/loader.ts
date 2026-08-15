import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  DomainPackSchema,
  PackItem,
  PackManifest,
  PackProject,
  PackResource,
  PackRubric,
  type DomainPack,
} from "./types";

/**
 * Reads a pack from disk.
 *
 * A pack is a directory of YAML files rather than one large document, because a
 * human has to review 40 items and 4 rubrics by hand (§23 Phase 0) and a
 * 900-line single file makes that review worse.
 *
 *   pack.yaml       manifest, skills, dependencies
 *   items.yaml      assessment item bank
 *   rubrics.yaml    rubrics
 *   projects.yaml   project briefs
 *   resources.yaml  §7.1's resource index — optional, like the rest
 */

export const PACKS_DIR = "packs";

const ItemsFile = z.object({ items: z.array(PackItem).default([]) });
const RubricsFile = z.object({ rubrics: z.array(PackRubric).default([]) });
const ProjectsFile = z.object({ projects: z.array(PackProject).default([]) });
const ResourcesFile = z.object({
  resources: z.array(PackResource).default([]),
});

export class PackParseError extends Error {
  constructor(file: string, detail: string) {
    super(`Failed to parse ${file}: ${detail}`);
    this.name = "PackParseError";
  }
}

function readYaml(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return parse(raw);
  } catch (error) {
    throw new PackParseError(path, (error as Error).message);
  }
}

function parseWith<T>(path: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Flatten to one line per problem so a failing build says exactly which
    // field in which file is wrong.
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new PackParseError(path, detail);
  }
  return result.data;
}

/** Loads and schema-validates a single pack directory. Does not run §7 checks. */
export function loadPack(dir: string): DomainPack {
  const manifestPath = join(dir, "pack.yaml");
  const manifestRaw = readYaml(manifestPath);
  if (manifestRaw === undefined) {
    throw new PackParseError(manifestPath, "file not found");
  }

  const manifest = parseWith(manifestPath, PackManifest, manifestRaw);

  const itemsPath = join(dir, "items.yaml");
  const rubricsPath = join(dir, "rubrics.yaml");
  const projectsPath = join(dir, "projects.yaml");

  const items = parseWith(itemsPath, ItemsFile, readYaml(itemsPath) ?? {}).items;
  const rubrics = parseWith(
    rubricsPath,
    RubricsFile,
    readYaml(rubricsPath) ?? {},
  ).rubrics;
  const projects = parseWith(
    projectsPath,
    ProjectsFile,
    readYaml(projectsPath) ?? {},
  ).projects;

  const resourcesPath = join(dir, "resources.yaml");
  const resources = parseWith(
    resourcesPath,
    ResourcesFile,
    readYaml(resourcesPath) ?? {},
  ).resources;

  return parseWith(dir, DomainPackSchema, {
    ...manifest,
    items,
    rubrics,
    projects,
    resources,
  });
}

/** Every pack directory under `packs/`, sorted for deterministic ordering. */
export function listPackDirs(root = PACKS_DIR): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .map((name) => join(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function loadAllPacks(root = PACKS_DIR): DomainPack[] {
  return listPackDirs(root).map(loadPack);
}
