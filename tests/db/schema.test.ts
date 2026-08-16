import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * These assert the §15 invariants the plan calls out by name. They are cheap,
 * but they are not ceremony: a migration that quietly drops the composite key
 * on `learner_skill_mastery`, or flips `seo_page.indexable` to default true,
 * would be a production incident rather than a compile error.
 */

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name).sort();
}

/** Every exported Drizzle table, paired with its export name. */
function allTables(): Array<[string, Parameters<typeof getTableConfig>[0]]> {
  return Object.entries(schema).filter(([, value]) => {
    try {
      getTableConfig(value as Parameters<typeof getTableConfig>[0]);
      return true;
    } catch {
      return false;
    }
  }) as Array<[string, Parameters<typeof getTableConfig>[0]]>;
}

describe("every table is well-formed", () => {
  const tables = allTables();

  it("finds all 54 tables", () => {
    expect(tables.length).toBe(54);
  });

  it.each(allTables())("%s has columns and a snake_case name", (name, table) => {
    const config = getTableConfig(table);
    expect(config.columns.length).toBeGreaterThan(0);
    expect(config.name).toMatch(/^[a-z][a-z0-9_]*$/);
    // Drizzle's index callbacks run during getTableConfig, so a malformed
    // index expression surfaces here rather than at migration time.
    expect(Array.isArray(config.indexes)).toBe(true);
  });

  it.each(allTables())("%s names every column in snake_case", (_name, table) => {
    for (const column of getTableConfig(table).columns) {
      expect(column.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it.each(allTables())("%s has a primary key", (_name, table) => {
    const config = getTableConfig(table);
    const hasComposite = config.primaryKeys.length > 0;
    const hasSingle = config.columns.some((c) => c.primary);
    expect(hasComposite || hasSingle).toBe(true);
  });

  it.each(allTables())(
    "%s resolves every foreign key to a real column",
    (_name, table) => {
      // Drizzle's `.references(() => other.column)` callbacks are lazy: a typo
      // in one is invisible until drizzle-kit runs. Resolving them here turns
      // that into a test failure instead of a broken migration.
      for (const fk of getTableConfig(table).foreignKeys) {
        const reference = fk.reference();
        expect(reference.columns.length).toBeGreaterThan(0);
        expect(reference.foreignColumns.length).toBe(reference.columns.length);
        for (const column of reference.foreignColumns) {
          expect(column.name).toMatch(/^[a-z][a-z0-9_]*$/);
        }
      }
    },
  );
});

describe("§15 — the schema shape", () => {
  it("exports every table group", () => {
    for (const name of [
      "user",
      "learnerProfile",
      "learningGoal",
      "domainPack",
      "skill",
      "skillDependency",
      "learnerSkillMastery",
      "curriculum",
      "curriculumModule",
      "learningPlan",
      "learningSession",
      "assessmentItem",
      "rubric",
      "project",
      "submission",
      "artifact",
      "evaluation",
      "masteryUpdate",
      "interaction",
      "agentRun",
      "seoPage",
    ]) {
      expect(schema).toHaveProperty(name);
    }
  });
});

describe("learner_skill_mastery — 'the single most important table'", () => {
  const config = getTableConfig(schema.learnerSkillMastery);

  it("is keyed on (userId, skillId), so a learner has one row per skill", () => {
    const pk = config.primaryKeys[0];
    expect(pk).toBeDefined();
    expect(pk!.columns.map((c) => c.name)).toEqual(["user_id", "skill_id"]);
  });

  it("carries the decay half-life needed to compute effective mastery", () => {
    expect(columnNames(schema.learnerSkillMastery)).toContain(
      "decay_half_life_days",
    );
    const halfLife = config.columns.find(
      (c) => c.name === "decay_half_life_days",
    );
    expect(halfLife?.notNull).toBe(true);
  });

  it("records when the skill was last *successfully* demonstrated", () => {
    // Decay is measured from the last success, not the last attempt — practising
    // and failing does not reset the clock.
    expect(columnNames(schema.learnerSkillMastery)).toContain("last_success_at");
    expect(columnNames(schema.learnerSkillMastery)).toContain("last_practiced_at");
    // The two are genuinely different columns, and the engine reads the first
    // one for decay. Storing only "last observed" would let a learner keep a
    // skill alive by repeatedly getting it wrong.
    expect(columnNames(schema.learnerSkillMastery)).not.toContain(
      "last_observed_at",
    );
  });
});

describe("mastery_update — the evidence audit trail (§4.2 law 1)", () => {
  const config = getTableConfig(schema.masteryUpdate);
  const names = config.columns.map((c) => c.name);

  it("records the prior, the posterior and the delta", () => {
    expect(names).toContain("prior_mastery");
    expect(names).toContain("posterior_mastery");
    expect(names).toContain("delta");
  });

  it("records which tier of evidence moved the number", () => {
    // Without this, "no mastery without evidence" is unverifiable after the fact.
    expect(names).toContain("evidence_tier");
    expect(names).toContain("observation_confidence");
    expect(names).toContain("reason");
  });

  it("links back to the evaluation or assessment that caused it", () => {
    expect(names).toContain("evaluation_id");
    expect(names).toContain("assessment_result_id");
  });
});

describe("evaluation — §14.5's output", () => {
  const names = getTableConfig(schema.evaluation).columns.map((c) => c.name);

  it("stores per-criterion results, confidence and the evidence tier", () => {
    expect(names).toContain("criterion_results");
    expect(names).toContain("confidence");
    expect(names).toContain("eval_tier");
  });

  it("records whether the quote verifier passed", () => {
    // The deterministic string-match check is the defence against hallucinated
    // evidence, so whether it ran and passed is part of the permanent record.
    expect(names).toContain("verifier_passed");
  });

  it("pins the model and prompt version that produced it", () => {
    expect(names).toContain("model_used");
    expect(names).toContain("prompt_version");
    expect(names).toContain("rubric_version");
  });
});

describe("seo_page — index bloat control (§12.1, §13.3)", () => {
  const config = getTableConfig(schema.seoPage);

  it("defaults `indexable` to false", () => {
    // The sitemap only ever contains indexable rows, so the default decides
    // whether a mistake leaks pages into the index or merely hides them.
    const indexable = config.columns.find((c) => c.name === "indexable");
    expect(indexable?.notNull).toBe(true);
    expect(indexable?.default).toBe(false);
  });

  it("keeps title and description in the database, not in code", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("title");
    expect(names).toContain("meta_description");
    expect(names).toContain("quality_score");
    expect(names).toContain("last_reviewed_at");
  });
});

describe("public_learning_path — Proof Pages default to private (§8 screen 12)", () => {
  const config = getTableConfig(schema.publicLearningPath);

  it("is private until explicitly shared", () => {
    const visibility = config.columns.find((c) => c.name === "visibility");
    expect(visibility?.default).toBe("private");
  });

  it("gates publication behind the quality gate", () => {
    const gate = config.columns.find((c) => c.name === "gate_passed");
    expect(gate?.default).toBe(false);
  });
});

describe("domain_pack — declared maturity (§7.1)", () => {
  const names = getTableConfig(schema.domainPack).columns.map((c) => c.name);

  it("records maturity, tier and workspace as data", () => {
    // §7.3 rule 1: the workspace is chosen by data, not code, so adding a
    // domain needs no code change.
    expect(names).toContain("maturity");
    expect(names).toContain("eval_tier");
    expect(names).toContain("workspace");
  });
});

describe("skill — the planner's inputs (§14.4)", () => {
  const names = getTableConfig(schema.skill).columns.map((c) => c.name);

  it("carries BKT priors and a can-do statement", () => {
    expect(names).toContain("bkt_priors");
    expect(names).toContain("can_do_statement");
    expect(names).toContain("eval_tier");
    expect(names).toContain("estimated_hours");
  });
});

describe("skill_dependency — hard vs soft (§14.4)", () => {
  const config = getTableConfig(schema.skillDependency);

  it("is keyed on the edge itself so an edge cannot be duplicated", () => {
    const pk = config.primaryKeys[0];
    expect(pk!.columns.map((c) => c.name)).toEqual([
      "from_skill_id",
      "to_skill_id",
    ]);
  });

  it("distinguishes the dependency type", () => {
    const type = config.columns.find((c) => c.name === "type");
    expect(type?.notNull).toBe(true);
  });
});

describe("interaction — cost and cache accounting (§14.9.4)", () => {
  const names = getTableConfig(schema.interaction).columns.map((c) => c.name);

  it("records cache reads, because a silent cache miss triples the bill", () => {
    expect(names).toContain("cache_read_tokens");
    expect(names).toContain("cost_cents");
    expect(names).toContain("latency_ms");
  });
});

describe("agent_run — prompt versioning (§14.8)", () => {
  const names = getTableConfig(schema.agentRun).columns.map((c) => c.name);

  it("pins the exact prompt version and model for every run", () => {
    expect(names).toContain("prompt_version");
    expect(names).toContain("model");
    expect(names).toContain("status");
    expect(names).toContain("cost_cents");
  });
});

describe("spend_ledger — the per-user cap (§14.9.7)", () => {
  const names = getTableConfig(schema.spendLedger).columns.map((c) => c.name);

  it("tracks spend, evaluation quota and degradation per period", () => {
    expect(names).toContain("cost_cents");
    expect(names).toContain("evaluations_used");
    expect(names).toContain("degraded");
    expect(names).toContain("period");
  });
});

describe("billing — the constraints that carry the money (E13)", () => {
  const unique = (table: Parameters<typeof getTableConfig>[0]) =>
    getTableConfig(table)
      .indexes.filter((i) => i.config.unique)
      .flatMap((i) => (i.config.columns ?? []).map((c) => (c as { name: string }).name));

  it("makes a replayed Stripe webhook impossible to file twice", () => {
    // The unique index *is* the idempotency mechanism: the handler inserts
    // before it acts, so a replay fails the insert and stops. A lookup and an
    // insert can interleave; a constraint cannot.
    expect(unique(schema.billingEvent)).toContain("stripe_event_id");
  });

  it("keeps one subscription row per Stripe subscription", () => {
    // `customer.subscription.updated` arrives more than once, and the handler
    // upserts on this column.
    expect(unique(schema.subscription)).toContain("stripe_subscription_id");
  });

  it("makes 'one referral per person' a database constraint", () => {
    // The single rule the whole abuse story rests on. A check in application
    // code can be raced by two concurrent signups; this cannot.
    expect(unique(schema.referral)).toContain("referee_id");
  });

  it("gives each account one referral code", () => {
    const columns = unique(schema.referralCode);
    expect(columns).toContain("code");
    expect(columns).toContain("user_id");
  });

  it("cannot record a cancellation without a reason", () => {
    // §25.1 marks the exit reason mandatory, in bold. This is what mandatory
    // means when the survey is the only structured signal about why people go.
    const reason = getTableConfig(schema.cancellationSurvey).columns.find(
      (c) => c.name === "reason",
    )!;
    expect(reason.notNull).toBe(true);
  });

  it("lets a grant be revoked independently of its dates", () => {
    // The refund path depends on revocation beating the window.
    const names = getTableConfig(schema.planGrant).columns.map((c) => c.name);
    expect(names).toContain("revoked_at");
    expect(names).toContain("ends_at");
  });

  it("stores signup signals hashed, never raw", () => {
    // PLAN-LOCALIZATION §5.2 — no IP value in any log or database row. A fraud
    // heuristic needs equality, which a hash preserves, not the address.
    const names = getTableConfig(schema.referral).columns.map((c) => c.name);
    expect(names).toContain("signup_ip_hash");
    expect(names).toContain("signup_ua_hash");
    expect(names).not.toContain("signup_ip");
  });
});

describe("resource — scoped RAG only (§14.7)", () => {
  const config = getTableConfig(schema.resource);

  it("has a pgvector embedding column", () => {
    const embedding = config.columns.find((c) => c.name === "embedding");
    expect(embedding).toBeDefined();
    expect(embedding!.getSQLType()).toContain("vector");
  });

  it("records when the URL was last verified", () => {
    // §14.6's resource-freshness check needs this to be able to fail.
    expect(config.columns.map((c) => c.name)).toContain("verified_at");
  });
});
