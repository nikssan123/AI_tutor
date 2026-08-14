import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getDb } from "@/db";
import { generatedPacks } from "@/lib/admin/generated";
import { loadAllPacks, PACKS_DIR } from "@/lib/packs/loader";
import { validatePack } from "@/lib/packs/validate";
import {
  Button,
  Card,
  EmptyState,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  stagger,
  Status,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { discardPackAction, promotePackAction } from "./actions";

export const metadata: Metadata = {
  title: "Packs",
  robots: { index: false, follow: false },
};

/**
 * §24 E2's acceptance criterion names `/admin/packs`, and until now only the
 * per-pack viewer beneath it existed.
 *
 * The index earns its place by answering the question the viewer cannot: which
 * pack needs attention? So it leads with validation state rather than with
 * names — a failing pack sorts to the top, because a list where the broken row
 * is eleventh is a list nobody reads.
 */
export default async function PacksIndexPage() {
  await requireAdmin();

  // §7.1's Generated tier lives only in the database, so it has no diff to
  // review and this is the only place anyone ever sees one.
  const generated = await generatedPacks(getDb());

  const packs = loadAllPacks(PACKS_DIR)
    .map((pack) => ({ pack, report: validatePack(pack) }))
    .sort((a, b) => {
      if (a.report.passed !== b.report.passed) return a.report.passed ? 1 : -1;
      return a.pack.name.localeCompare(b.pack.name);
    });

  const failing = packs.filter((entry) => !entry.report.passed).length;

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Operations"
        title="Packs"
        lead="What we can teach, and whether it still validates."
        facts={
          <>
            <Meta>
              {packs.length} pack{packs.length === 1 ? "" : "s"} on disk
            </Meta>
            {failing > 0 ? (
              <Status tone="problem">{failing} failing validation</Status>
            ) : (
              <Status tone="verified">All passing</Status>
            )}
          </>
        }
      />

      {packs.length === 0 ? (
        <Card>
          <EmptyState message="No packs found on disk." />
        </Card>
      ) : (
        <RowList>
          {packs.map(({ pack, report }, i) => (
            <Row key={pack.slug} style={stagger(i)}>
              <span className="flex min-w-0 flex-col gap-1">
                <Link
                  href={`/admin/packs/${pack.slug}`}
                  className="truncate hover:underline"
                >
                  {pack.name}
                </Link>
                <span className="flex flex-wrap items-center gap-4">
                  <MaturityBadge
                    maturity={pack.maturity}
                    review={pack.quality.reviewKind}
                  />
                  <Meta>
                    {report.stats.skills} skills · {report.stats.items} items ·
                    tier {pack.evalTier}
                  </Meta>
                </span>
              </span>
              <Status tone={report.passed ? "verified" : "problem"}>
                {report.passed ? "Passing" : "Failing"}
              </Status>
            </Row>
          ))}
        </RowList>
      )}

      {/* ── The review queue ───────────────────────────────────────────────── */}
      {/* A section of the Packs page, not a second page, so `SectionHead` — an
          h2 like every other band in the product. Two h1s is a real semantics
          problem, not just a failing query. */}
      <SectionHead label="The review queue" title="Built on request" />
      <Meta>
        Written for a learner who asked for a subject nobody had curated.
        Promoting one to Standard is a claim that you have read it.
      </Meta>

      {generated.length === 0 ? (
        <Card>
          <EmptyState message="Nothing has been generated yet." />
        </Card>
      ) : (
        <RowList>
          {generated.map(({ pack, report, learners, build, promotable, blockers }, i) => (
            <Row key={pack.slug} style={stagger(i)}>
              <span className="flex min-w-0 flex-col gap-1">
                <Link
                  href={`/admin/packs/${pack.slug}`}
                  className="truncate hover:underline"
                >
                  {pack.name}
                </Link>
                <span className="flex flex-wrap items-center gap-4">
                  <Meta>
                    {report.stats.skills} skills · {report.stats.items} items ·
                    tier {pack.evalTier} · {learners} learner
                    {learners === 1 ? "" : "s"}
                  </Meta>
                  {build?.status === "failed" ? (
                    <Status tone="problem">{build.detail ?? "Build failed"}</Status>
                  ) : null}
                </span>
                {/* Why it cannot be promoted, rather than a disabled button
                    with no explanation attached to it. */}
                {promotable ? null : <Meta tone="muted">{blockers.join(" · ")}</Meta>}
              </span>

              <span className="flex shrink-0 items-center gap-3">
                {promotable ? (
                  <form action={promotePackAction}>
                    <input type="hidden" name="slug" value={pack.slug} />
                    <Button type="submit">Promote</Button>
                  </form>
                ) : null}
                {learners === 0 ? (
                  <form action={discardPackAction}>
                    <input type="hidden" name="slug" value={pack.slug} />
                    <button
                      type="submit"
                      className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                    >
                      Discard
                    </button>
                  </form>
                ) : null}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </AppFrame>
  );
}
