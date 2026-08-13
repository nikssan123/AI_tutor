import type { DomainPack } from "@/lib/packs/types";

/**
 * The project an `apply` block is asking for.
 *
 * A block carries a rubric id rather than a project slug (§14.9.2's session
 * contract), so the project is the one that publishes that rubric. Falling back
 * to a project targeting the skill covers a block composed before the pack had
 * rubrics on its projects — a thin pack, not a broken one.
 *
 * It lives here rather than beside `submitWorkAction` because that module is
 * `"use server"`, and every export from one of those must be an async function.
 * A synchronous helper exported from it compiles under `tsc` and passes lint and
 * every unit test, then fails at bundle time and takes the whole session page
 * down with it — which is exactly what it did.
 */
export function projectForBlock(
  pack: DomainPack,
  rubricId: string | null,
  skillSlug: string,
) {
  const byRubric = rubricId
    ? pack.projects.find((p) => p.rubric === rubricId)
    : undefined;

  return (
    byRubric ?? pack.projects.find((p) => p.targetSkills.includes(skillSlug))
  );
}
