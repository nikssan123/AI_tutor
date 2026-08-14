import { canonical } from "@/lib/site";
import type { EnvLike } from "@/lib/env-types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import type { ThemeChoice } from "@/lib/theme-script";
import { copyFor } from "./copy";
import { fill, renderMessage, type EmailMessage } from "./render";

/**
 * The messages a person sends, from `/admin/mail`.
 *
 * A catalog rather than a free HTML box, for three reasons that all cost
 * something to give up: a template exists in four languages, so the operator
 * can write to a German learner in German without speaking German; it renders
 * through the same frame as the system mail, so outreach does not look like a
 * different company; and it is a named thing that can be counted, so "we sent
 * 40 check-ins and 6 replied" is answerable.
 *
 * The operator-facing labels here are English and stay English. `/admin` is an
 * internal surface for one operator (PLAN-LOCALIZATION §2 excludes it); the
 * *reader's* language is the one that gets four translations.
 */

export const TEMPLATE_IDS = [
  "welcome",
  "checkIn",
  "packReady",
  "reply",
  "resolved",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Where a thread started, which is also how the inbox filters it. */
export type ThreadKind = "outreach" | "support";

export interface TemplateVariable {
  name: string;
  /** Shown above the field in `/admin/mail/compose`. English, see above. */
  label: string;
  /** Rendered as a textarea, and allowed to contain line breaks. */
  multiline: boolean;
}

export interface OperatorTemplate {
  id: TemplateId;
  name: string;
  description: string;
  kind: ThreadKind;
  /**
   * What the operator fills in. `sender`, `brand` and `subject` are not here —
   * they come from the acting admin, the copy and the thread, and a field the
   * operator can get wrong is a field they should not be shown.
   */
  variables: TemplateVariable[];
  /**
   * True when the subject is the thread's rather than the template's, which is
   * what keeps a reply in the same conversation in the reader's mail client.
   */
  repliesInThread: boolean;
}

const NAME: TemplateVariable = {
  name: "name",
  label: "Their name",
  multiline: false,
};

export const TEMPLATES: readonly OperatorTemplate[] = [
  {
    id: "welcome",
    name: "Welcome",
    description:
      "A personal hello after sign-up. Says what the product is for and invites a reply.",
    kind: "outreach",
    variables: [NAME],
    repliesInThread: false,
  },
  {
    id: "checkIn",
    name: "Check in",
    description:
      "For a learner who set a goal and went quiet. Asks what got in the way.",
    kind: "outreach",
    variables: [
      NAME,
      { name: "goal", label: "The goal they set", multiline: false },
    ],
    repliesInThread: false,
  },
  {
    id: "packReady",
    name: "Subject is ready",
    description: "The subject they asked us to build now exists.",
    kind: "outreach",
    variables: [
      NAME,
      {
        name: "topic",
        label: "The subject, as they'd name it",
        multiline: false,
      },
    ],
    repliesInThread: false,
  },
  {
    id: "reply",
    name: "Reply",
    description:
      "An answer in your own words, in their language's frame. Used by the thread view.",
    kind: "support",
    variables: [
      NAME,
      { name: "message", label: "Your answer", multiline: true },
    ],
    repliesInThread: true,
  },
  {
    id: "resolved",
    name: "Reply and resolve",
    description:
      "An answer that also closes the thread, and says replying reopens it.",
    kind: "support",
    // The same variable name as `reply`, deliberately: the thread view offers
    // both as two submit buttons on one form, and a second field name would
    // mean a second textarea or a JavaScript toggle to hide one of them.
    variables: [
      NAME,
      { name: "message", label: "Your answer", multiline: true },
    ],
    repliesInThread: true,
  },
];

/**
 * Where a template's button points, for the templates that have one.
 *
 * Keyed by id and deliberately partial rather than a field on the template
 * above: whether a button exists at all is decided by the copy, and a path
 * sitting on an entry whose copy has no button is a value that can silently
 * stop matching it. The two support templates are absent because a reply that
 * ends in a call to action is selling rather than answering.
 */
const ACTION_PATHS: Partial<Record<TemplateId, string>> = {
  welcome: "/today",
  checkIn: "/today",
  packReady: "/subjects",
};

export function templateById(id: string): OperatorTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/**
 * Which fields the operator left blank.
 *
 * Every variable is required. An optional one would mean copy that reads
 * correctly with the value missing, and none of these do — "Hi , you asked for
 * " is not a message worth having a code path for.
 */
export function missingVariables(
  template: OperatorTemplate,
  values: Record<string, string | undefined>,
): string[] {
  return template.variables
    .filter((variable) => (values[variable.name] ?? "").trim() === "")
    .map((variable) => variable.name);
}

export interface OperatorRenderInput {
  template: OperatorTemplate;
  to: string;
  locale: Locale;
  /**
   * The **recipient's** appearance choice, not the operator's.
   *
   * Worth stating because this is the one send composed from someone else's
   * browser: the cookie and the `localStorage` entry in the tab this call runs
   * in belong to the admin, and theming a learner's mail from them would be
   * exactly backwards. It comes from their account row, like the locale above.
   */
  theme?: ThemeChoice;
  /** What the operator typed, keyed by variable name. */
  variables: Record<string, string | undefined>;
  /** The acting operator, as the reader should see them. */
  sender: string;
  /** The thread's subject — used by the two templates that reply in-thread. */
  threadSubject?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  env?: EnvLike;
}

/**
 * A catalog entry plus a locale plus the operator's words → a sendable message.
 *
 * Pure, and separated from `lib/mail/send.ts` for one specific reason: the
 * compose screen renders a preview with exactly this call and sends with the
 * same one, so what the operator approves is the message that goes out rather
 * than an approximation of it.
 */
export function renderOperatorMessage(
  input: OperatorRenderInput,
): EmailMessage {
  const locale = input.locale;
  const copy = copyFor(locale);
  const entry = copy.operator[input.template.id];

  const values: Record<string, string | undefined> = {
    ...input.variables,
    brand: copy.brand,
    sender: input.sender,
    subject: input.threadSubject ?? "",
  };

  // The copy decides whether there is a button; `ACTION_PATHS` only says where
  // it goes, and is non-empty for exactly the entries whose copy has a label.
  const action =
    "action" in entry
      ? {
          label: fill(entry.action, values),
          url: canonical(ACTION_PATHS[input.template.id]!, input.env),
        }
      : undefined;

  return renderMessage({
    to: input.to,
    subject: fill(entry.subject, values),
    locale,
    theme: input.theme,
    env: input.env,
    content: {
      heading: fill(entry.heading, values),
      body: entry.body.map((line) => fill(line, values)),
      ...(action === undefined ? {} : { action }),
      signature: fill(entry.signature, values),
      footer: fill(entry.footer, values),
    },
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
  });
}

/** The subject a new outreach thread is filed under, in the operator's list. */
export function threadSubjectFor(
  template: OperatorTemplate,
  variables: Record<string, string | undefined>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const copy = copyFor(locale);
  return fill(copy.operator[template.id].subject, {
    ...variables,
    brand: copy.brand,
  });
}
