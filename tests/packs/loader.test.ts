import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listPackDirs,
  loadAllPacks,
  loadPack,
  PackParseError,
} from "@/lib/packs/loader";

const FIXTURES = "tests/fixtures/packs";

describe("loadPack", () => {
  it("assembles a pack from its four files", () => {
    const pack = loadPack(join(FIXTURES, "valid-minimal"));
    expect(pack.slug).toBe("valid-minimal");
    expect(pack.skills).toHaveLength(2);
    expect(pack.dependencies).toHaveLength(1);
    expect(pack.items).toHaveLength(4);
    expect(pack.rubrics).toHaveLength(1);
    expect(pack.projects).toHaveLength(1);
  });

  it("applies schema defaults", () => {
    const pack = loadPack(join(FIXTURES, "valid-minimal"));
    expect(pack.version).toBe(1);
    expect(pack.dependencies[0]!.strength).toBe(1);
    expect(pack.quality.status).toBe("draft");
    expect(pack.items[0]!.discrimination).toBe(1);
  });

  it("fails with the file and field named when the manifest is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-invalid-"));
    try {
      writeFileSync(
        join(dir, "pack.yaml"),
        "slug: Bad_Slug\nname: x\nmaturity: curated\nevalTier: 1\nworkspace: text\nskills: []\n",
      );
      expect(() => loadPack(dir)).toThrow(PackParseError);
      // The message has to name the field, or a 900-line pack is unfixable.
      expect(() => loadPack(dir)).toThrow(/slug/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("labels a root-level schema error as (root)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-rooterr-"));
    try {
      // A scalar where the manifest object should be: the Zod issue has an
      // empty path, so the message needs a stand-in rather than an empty label.
      writeFileSync(join(dir, "pack.yaml"), "just-a-string\n");
      expect(() => loadPack(dir)).toThrow(/\(root\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the manifest is missing entirely", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-empty-"));
    try {
      expect(() => loadPack(dir)).toThrow(/file not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on malformed YAML rather than silently loading nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-badyaml-"));
    try {
      writeFileSync(join(dir, "pack.yaml"), "slug: x\n  bad: [indent\n");
      expect(() => loadPack(dir)).toThrow(PackParseError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats missing item, rubric and project files as empty", () => {
    // A pack may legitimately ship skills only — a Generated pack starts there.
    const dir = mkdtempSync(join(tmpdir(), "pack-skills-only-"));
    try {
      writeFileSync(
        join(dir, "pack.yaml"),
        [
          "slug: skills-only",
          "name: Skills Only",
          "maturity: generated",
          "evalTier: 2",
          "workspace: text",
          "skills:",
          "  - slug: only",
          "    name: Only",
          "    description: The only skill.",
          "    level: core",
          "    area: basics",
          "    evalTier: 2",
          "    estimatedHours: 1",
          "    canDoStatement: do the only thing",
          "    observableEvidence: [document]",
          "    bktPriors: { pInit: 0.1, pLearn: 0.2, pSlip: 0.1, pGuess: 0.1 }",
        ].join("\n"),
      );
      const pack = loadPack(dir);
      expect(pack.items).toEqual([]);
      expect(pack.rubrics).toEqual([]);
      expect(pack.projects).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an items file whose entries are malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-baditems-"));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "pack.yaml"),
        [
          "slug: bad-items",
          "name: Bad Items",
          "maturity: standard",
          "evalTier: 2",
          "workspace: text",
          "skills:",
          "  - slug: only",
          "    name: Only",
          "    description: The only skill.",
          "    level: core",
          "    area: basics",
          "    evalTier: 2",
          "    estimatedHours: 1",
          "    canDoStatement: do the only thing",
          "    observableEvidence: [document]",
          "    bktPriors: { pInit: 0.1, pLearn: 0.2, pSlip: 0.1, pGuess: 0.1 }",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, "items.yaml"),
        "items:\n  - slug: x\n    skill: only\n    type: nonsense\n    difficulty: 0.5\n    prompt: too short\n",
      );
      expect(() => loadPack(dir)).toThrow(/items\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("listPackDirs", () => {
  it("lists pack directories in sorted order", () => {
    const dirs = listPackDirs(FIXTURES);
    expect(dirs.length).toBeGreaterThan(1);
    expect([...dirs].sort()).toEqual(dirs);
    expect(dirs.some((d) => d.endsWith("valid-minimal"))).toBe(true);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(listPackDirs("no/such/place")).toEqual([]);
  });

  it("skips an entry that cannot be stat'd", () => {
    // A dangling symlink makes statSync throw. Real cause: an entry removed
    // between readdir and stat, which is a race a seed job can genuinely hit.
    const root = mkdtempSync(join(tmpdir(), "packs-dangling-"));
    try {
      mkdirSync(join(root, "real-pack"));
      symlinkSync(join(root, "gone"), join(root, "dangling"));
      expect(listPackDirs(root)).toEqual([join(root, "real-pack")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores files sitting alongside the pack directories", () => {
    const root = mkdtempSync(join(tmpdir(), "packs-root-"));
    try {
      writeFileSync(join(root, "README.md"), "not a pack");
      mkdirSync(join(root, "a-pack"));
      expect(listPackDirs(root)).toEqual([join(root, "a-pack")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadAllPacks", () => {
  it("loads every real pack in the repository", () => {
    // Pinned by name rather than counted, so a pack silently disappearing from
    // disk fails here instead of quietly shrinking the product.
    expect(loadAllPacks().map((p) => p.slug).sort()).toEqual([
      "business-writing",
      "photography",
      "python-fundamentals",
      "sql-data-analysis",
    ]);
  });
});
