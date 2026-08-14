import type { Metadata } from "next";
import Link from "next/link";

/**
 * The admin segment's shell — chrome and `noindex`, and deliberately **not**
 * the authorization boundary.
 *
 * Next is explicit that a layout cannot be one: it "does not control whether
 * the rest of the route renders. Route segments and parallel route slots are
 * rendered by the router, so a layout that hides or swaps them does not stop
 * them from running or from appearing in the RSC Payload"
 * (`next/dist/docs/01-app/02-guides/authentication.md`). A `requireAdmin()`
 * call here would read as security while the page below it still ran and still
 * shipped its data. So every page under `/admin` calls the guard itself, and
 * this file is only allowed to do cosmetics.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Nothing under /admin is ever statically cached. */
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Console" },
  { href: "/admin/packs", label: "Packs" },
  { href: "/admin/data", label: "Data" },
  { href: "/admin/sql", label: "SQL" },
  { href: "/admin/audit", label: "Audit" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ground text-ink">
      <nav className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <span className="text-[length:var(--text-label-size)] font-semibold">
            Admin
          </span>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[length:var(--text-label-size)] text-ink-muted hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
