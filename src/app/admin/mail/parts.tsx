import { Card, cx, Meta, Status, type StatusTone } from "@/components/ui";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locales";
import type { OperatorTemplate } from "@/lib/email/catalog";

/**
 * The pieces all three mail screens share.
 *
 * Not a route file — Next only treats `page`, `layout`, `route` and friends
 * specially, so a plain module can live beside them. Keeping these here rather
 * than in `src/components/ui` is deliberate: they are operator chrome, and the
 * kit is the learner-facing design system.
 */

/** `searchParams` values can arrive as arrays; a form field wants one string. */
export function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The result of the last action, carried in the URL so no-JS forms can report. */
export function Notice({
  message,
  ok,
}: {
  message: string | undefined;
  ok: boolean;
}) {
  if (message === undefined) return null;

  return (
    <Card className={cx("rise border-l-4", ok ? "border-l-accent" : "border-l-problem")}>
      <Status tone={ok ? "verified" : "problem"}>{message}</Status>
    </Card>
  );
}

export function toneForMessage(status: string): StatusTone {
  if (status === "sent" || status === "received") return "verified";
  return status === "failed" ? "problem" : "attention";
}

/**
 * Which language the message is written in.
 *
 * A visible control on every send rather than a silent read of the account,
 * because the operator is the one who can see that a person wrote in in English
 * despite holding their account in German — and PLAN-LOCALIZATION decision 4
 * puts the authenticated locale on the account, which is a fact about the UI
 * rather than about this conversation.
 */
export function LocaleField({ selected }: { selected: Locale }) {
  return (
    <label className="flex flex-col gap-2">
      <Meta>Language</Meta>
      <select
        name="locale"
        defaultValue={selected}
        className="max-w-xs rounded-[var(--radius-control)] border border-hairline bg-ground px-3 py-2 text-ink"
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The fields a template declares, and no others.
 *
 * Both screens render their inputs through this rather than hand-writing them,
 * which is what keeps the form and the catalog from drifting: adding a variable
 * to a template makes the field appear, and — more to the point — a variable
 * *renamed* in the catalog cannot leave a form posting the old name and a
 * message rendering with a hole in it.
 */
export function Fields({
  template,
  values,
  required,
}: {
  template: OperatorTemplate;
  values: Record<string, string>;
  /**
   * The reply form marks its fields required, because it posts the message.
   * The compose screen does not: its first submit is a GET that re-renders the
   * preview, and a half-filled preview is exactly what someone writing an
   * outreach note wants to look at before finishing it.
   */
  required: boolean;
}) {
  return (
    <>
      {template.variables.map((variable) => (
        <label key={variable.name} className="flex flex-col gap-2">
          <Meta>{variable.label}</Meta>
          {variable.multiline ? (
            <textarea
              name={variable.name}
              rows={8}
              required={required}
              defaultValue={values[variable.name]}
              className="w-full resize-y rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          ) : (
            <input
              name={variable.name}
              required={required}
              defaultValue={values[variable.name]}
              className="max-w-md rounded-[var(--radius-control)] border border-hairline bg-ground px-3 py-2 text-ink"
            />
          )}
        </label>
      ))}
    </>
  );
}

/** UTC, to the minute — the same format the audit log and console use. */
export function when(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 16);
}
