import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { loadAllPacks, PACKS_DIR } from "@/lib/packs/loader";
import { validatePack } from "@/lib/packs/validate";
import {
  Card,
  DisplayTitle,
  EmptyState,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  stagger,
  Status,
} from "@/components/ui";

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

  const packs = loadAllPacks(PACKS_DIR)
    .map((pack) => ({ pack, report: validatePack(pack) }))
    .sort((a, b) => {
      if (a.report.passed !== b.report.passed) return a.report.passed ? 1 : -1;
      return a.pack.name.localeCompare(b.pack.name);
    });

  const failing = packs.filter((entry) => !entry.report.passed).length;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <DisplayTitle>Packs</DisplayTitle>
        <Meta>
          {packs.length} pack{packs.length === 1 ? "" : "s"} on disk
          {failing > 0 ? ` · ${failing} failing validation` : " · all passing"}
        </Meta>
      </header>

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
                  <MaturityBadge maturity={pack.maturity} />
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
    </main>
  );
}
