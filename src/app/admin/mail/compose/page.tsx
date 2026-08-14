import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { accountFor } from "@/lib/mail/store";
import { resolveLocale, type Locale } from "@/lib/i18n/locales";
import { supportFrom } from "@/lib/email/addresses";
import {
  missingVariables,
  renderOperatorMessage,
  TEMPLATES,
  templateById,
  type OperatorTemplate,
} from "@/lib/email/catalog";
import { Card, Meta, stagger } from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { sendMailAction } from "../actions";
import { Fields, LocaleField, Notice, one } from "../parts";

export const metadata: Metadata = {
  title: "Write",
  robots: { index: false, follow: false },
};

/**
 * Writing to someone who has not written to us.
 *
 * Three steps, and the middle one is the point: **pick, preview, send**. The
 * preview is rendered by the same `renderOperatorMessage` call the send makes,
 * so what appears on screen is the message rather than an impression of it —
 * which matters most for the three languages the operator cannot proofread.
 *
 * The whole screen works with scripting off. Choosing a template is a GET
 * (the fields it needs are decided on the server and come back in the URL), and
 * only the final send is a POST. That is why there is a "Load" button: without
 * JavaScript nothing can react to a `select` changing, and a form that silently
 * required JavaScript would be the one page of the console that broke in a
 * text browser.
 */

/** Only outreach templates start a conversation; the rest answer one. */
export const COMPOSABLE = TEMPLATES.filter(
  (template) => !template.repliesInThread,
);

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const admin = await requireAdmin();
  const query = await searchParams;

  const selected = templateById(one(query.template) ?? "");
  const template =
    selected === undefined || selected.repliesInThread ? undefined : selected;

  const to = one(query.to) ?? "";
  // A learner's own language is the right default, and looking it up here is
  // what makes it one: an operator who has to check the account first will
  // eventually not check.
  const account = to === "" ? undefined : await accountFor(getDb(), to);
  const locale: Locale = resolveLocale(
    one(query.locale) ?? account?.locale ?? "en",
  );

  const values: Record<string, string> = {};
  for (const variable of template?.variables ?? []) {
    values[variable.name] =
      one(query[variable.name]) ?? (variable.name === "name" ? (account?.name ?? "") : "");
  }

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Mail"
        title="Write to someone"
        lead="A template, in their language, previewed before it goes."
        facts={
          <>
            <Meta>From {supportFrom()}</Meta>
            <Link
              href="/admin/mail"
              className="text-[length:var(--text-meta-size)] font-[550] text-accent underline-offset-4 hover:underline"
            >
              Back to the inbox
            </Link>
          </>
        }
      />

      <Notice message={one(query.notice)} ok={one(query.ok) === "1"} />

      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <SectionHead label="Step one" title="Pick and fill in" />

        <form method="get" className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <Meta>Template</Meta>
            <select
              name="template"
              defaultValue={template?.id ?? ""}
              className="max-w-md rounded-[var(--radius-control)] border border-hairline bg-ground px-3 py-2 text-ink"
            >
              <option value="">Choose one…</option>
              {COMPOSABLE.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.description}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <Meta>To</Meta>
            <input
              name="to"
              type="email"
              defaultValue={to}
              placeholder="someone@example.com"
              className="max-w-md rounded-[var(--radius-control)] border border-hairline bg-ground px-3 py-2 text-ink placeholder:text-ink-faint"
            />
          </label>

          <LocaleField selected={locale} />

          {template === undefined ? null : (
            <Fields template={template} values={values} required={false} />
          )}

          <button
            type="submit"
            className="self-start rounded-[var(--radius-control)] border border-hairline px-5 py-2.5 font-[550]"
          >
            {template === undefined ? "Load the template" : "Update the preview"}
          </button>
        </form>
      </section>

      {template === undefined ? null : (
        <Preview
          template={template}
          to={to}
          locale={locale}
          values={values}
          sender={admin.name}
        />
      )}
    </AppFrame>
  );
}

/**
 * What will arrive, and the button that sends exactly it.
 *
 * The plain-text half is what is shown, because it is the half that carries
 * every word — the HTML adds a frame and a button around the same sentences,
 * and a preview that renders HTML in an iframe would show the operator a
 * rectangle rather than the copy they are checking.
 */
export function Preview({
  template,
  to,
  locale,
  values,
  sender,
}: {
  template: OperatorTemplate;
  to: string;
  locale: Locale;
  values: Record<string, string>;
  sender: string;
}) {
  const blockers = [
    ...missingVariables(template, values),
    ...(to === "" ? ["a recipient"] : []),
  ];
  const message = renderOperatorMessage({
    template,
    to,
    locale,
    variables: values,
    sender,
  });

  return (
    <section className="rise flex flex-col gap-6" style={stagger(2)}>
      <SectionHead label="Step two" title="Read it, then send it" />

      <Card className="flex flex-col gap-4">
        <Meta>Subject</Meta>
        <p className="font-[550]">{message.subject}</p>
        <Meta>Body</Meta>
        <pre className="whitespace-pre-wrap font-sans text-ink">
          {message.text}
        </pre>
      </Card>

      {blockers.length > 0 ? (
        <Meta>Fill in {blockers.join(", ")} before this can be sent.</Meta>
      ) : (
        <form action={sendMailAction}>
          <input type="hidden" name="template" value={template.id} />
          <input type="hidden" name="to" value={to} />
          <input type="hidden" name="locale" value={locale} />
          {template.variables.map((variable) => (
            <input
              key={variable.name}
              type="hidden"
              name={variable.name}
              value={values[variable.name]}
            />
          ))}
          <button
            type="submit"
            className="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-[550] text-on-accent"
          >
            Send to {to}
          </button>
        </form>
      )}
    </section>
  );
}
