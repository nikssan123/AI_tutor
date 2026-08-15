import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAuth, googleEnabled, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { requireUser } from "@/lib/account/session";
import {
  MAX_HANDLE_LENGTH,
  MAX_NAME_LENGTH,
  MIN_HANDLE_LENGTH,
} from "@/lib/account/profile";
import { zoneGroups } from "@/lib/account/timezones";
import {
  LOCALE_NAMES,
  LOCALES,
  resolveLocale,
} from "@/lib/i18n/locales";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Field,
  Meta,
  SelectField,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { GoogleIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  changeEmailAction,
  emailPasswordLinkAction,
  linkGoogleAction,
  rememberThemeAction,
  resendVerificationAction,
  setPasswordAction,
  signOutAction,
  signOutEverywhereAction,
  unlinkGoogleAction,
  updateProfileAction,
} from "./actions";

/**
 * The account screen — everything a person owns about their own account, on one
 * page, in the order they are likely to want it.
 *
 * Every form posts to a Server Action and the result comes back as a sentence
 * in the query string, which is what lets the whole page work with no client
 * JavaScript at all — including on the day a bundle fails to load, which is
 * exactly the day someone needs to change a password.
 *
 * ## Why this is `wide`, when a task screen is normally `narrow`
 *
 * §8.5.9's narrow column is for a screen that is *one* task — a goal form, a
 * sign-in — where a long line would be a worse form. This is not that screen.
 * It is seven unrelated concerns that happen to share an owner, and stacking
 * them one per row in a 530px column produced a page four viewports tall whose
 * last three cards were a title, one sentence and a single text button each,
 * floating in ~370px of dead gutter on either side.
 *
 * So the column widens and the short cards pair up. The measure argument is
 * unaffected: nothing here is prose, and the two cards that do hold a real form
 * split their own fields into two columns rather than stretching an input to
 * 976px.
 *
 * ## Why Profile and Email are the wide ones
 *
 * They are the two with a form in them, and that is the whole rule.
 *
 * Email was a normal half-width card until the password change moved to the
 * inbox. That took two fields out of the Password card and left it a sentence
 * and one text button — about 215px of card in a row whose other half, Email,
 * was still 415px of address, state, resend and a change form. A grid row is as
 * tall as its tallest cell, so the right column held ~230px of nothing between
 * the Password card's bottom edge and the row below it: a hole in the middle of
 * the page, which reads as something that failed to render.
 *
 * Widening Email fixes it at the cause rather than padding the symptom. Every
 * card left in the grid is now the same shape — a title, a sentence, a control
 * — so they pair off at roughly equal heights and any space left over is at the
 * end of the last row, where the page was going to stop anyway.
 */
export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

/** The provider id Better Auth writes for an email-and-password account. */
const CREDENTIAL = "credential";
const GOOGLE = "google";

type Props = {
  searchParams: Promise<{ ok?: string; error?: string; confirm?: string }>;
};

/**
 * The pair-up. Cards flow into it in source order, so the two that carry real
 * forms lead and the short ones fall into rows behind them.
 *
 * One column until `sm`, because two 240px cards side by side on a phone is not
 * a denser page, it is two unreadable ones.
 *
 * `items-start` because these cards have genuinely different amounts to say.
 * Stretching a row to its tallest card put a third of a card's height of empty
 * space between the Password card's one sentence and its one button — a void
 * inside a drawn border, which reads as something failing to load. Uneven
 * bottom edges are the honest version: the card is short because there is
 * little to say.
 */
const grid = "grid items-start gap-6 sm:grid-cols-2";

export default async function AccountPage({ searchParams }: Props) {
  const user = await requireUser();
  const { ok, error, confirm } = await searchParams;

  /*
   * Sent here by the unconfirmed-address banner.
   *
   * The banner's link used to be a bare `/account`, which from /account itself
   * — where the banner is also drawn — was a click that did nothing at all.
   * The fragment scrolls the Email card up; this rings it, so the control the
   * banner meant is the one thing on the screen wearing a border.
   *
   * `emailVerified` is in the condition because the address can be confirmed
   * between the click and the render — in another tab, or by a code typed a
   * minute ago — and a ring around "Confirmed" is a page pointing at nothing.
   */
  const spotlight = Boolean(confirm) && !user.emailVerified;

  const accounts = await getAuth().api.listUserAccounts({
    headers: await headers(),
  });
  const providers = new Set(accounts.map((account) => account.providerId));
  const hasPassword = providers.has(CREDENTIAL);
  const hasGoogle = providers.has(GOOGLE);

  const zones = zoneGroups(user.timezone);

  return (
    <AppFrame width="wide">
      {/* No facts row: every card below carries its own state, and a header
          that repeated "Confirmed" would be saying it twice on one screen. */}
      <AppHeader title="Account" lead="Your details, and how you sign in." />

      {/* The outcome of whatever was just submitted. One line, at the top,
          where the eye already is after a form post. */}
      {ok ? <Status tone="verified">{ok}</Status> : null}
      {error ? <Status tone="problem">{error}</Status> : null}

      <div className={grid}>
        {/* ── Profile ────────────────────────────────────────────────────── */}
        <Card
          className="rise flex flex-col gap-6 sm:col-span-2"
          style={stagger(1)}
        >
          <Title>Profile</Title>

          <form action={updateProfileAction} className="flex flex-col gap-6">
            <div className={grid}>
              <Field
                label="Name"
                name="name"
                defaultValue={user.name}
                maxLength={MAX_NAME_LENGTH}
                required
              />

              <Field
                label="Handle"
                name="handle"
                defaultValue={user.handle ?? ""}
                maxLength={MAX_HANDLE_LENGTH}
                placeholder="nikolay"
                hint={`Optional and public. It appears in the web address of any Proof Page you publish. Letters, numbers and hyphens, ${MIN_HANDLE_LENGTH}–${MAX_HANDLE_LENGTH} characters.`}
              />

              {/*
               * A select over the platform's tz database rather than the
               * datalist this used to be. `zoneGroups` is what guarantees the
               * saved value is one of the options — see the note there; without
               * it this control silently relocates anyone whose zone the
               * canonical list spells differently.
               */}
              <SelectField
                label="Timezone"
                name="timezone"
                defaultValue={user.timezone}
                hint="Decides which day your work counts towards."
                required
              >
                {zones.map((group) => (
                  <optgroup key={group.area} label={group.area}>
                    {group.zones.map((zone) => (
                      <option key={zone.value} value={zone.value}>
                        {zone.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectField>

              {/*
               * Endonyms, from `LOCALE_NAMES` — someone who needs this control
               * is by definition someone who may not read the language the rest
               * of the page is written in.
               */}
              <SelectField
                label="Language"
                name="locale"
                defaultValue={resolveLocale(user.locale)}
                hint="The language we write to you in. The product itself is English for now."
                required
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_NAMES[locale]}
                  </option>
                ))}
              </SelectField>
            </div>

            <div>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Card>

        {/* ── Email ──────────────────────────────────────────────────────── */}
        {/* `id` is the banner's target. It is not on the address input, which
            already owns `newEmail`: the thing being pointed at is the card, and
            an anchor on a field inside it would scroll past the state and the
            resend to land on "Change it" — the one control in here that is not
            what the banner meant. */}
        <Card
          id="email"
          className={cx(
            "rise flex flex-col gap-6 sm:col-span-2",
            spotlight && "spotlight",
          )}
          style={stagger(2)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Title>Email</Title>
            {user.emailVerified ? (
              <Status tone="verified">Confirmed</Status>
            ) : (
              <Status tone="attention">Not confirmed</Status>
            )}
          </div>

          {/*
           * Two columns, like Profile, and for the same reason turned around.
           *
           * This card holds a form, so it is one of the two that has something
           * to fill a wide row with. Everything else on the screen is a
           * sentence and a control. Left is the address you have and what we
           * can do with it; right is the address you want instead.
           */}
          <div className={grid}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-[length:var(--text-label-size)] font-[550] text-ink">
                  {user.email}
                </span>
                {user.emailVerified ? (
                  <Meta>
                    We can send you a password reset if you ever need one.
                  </Meta>
                ) : (
                  <Meta>
                    Until you confirm this address, we cannot send you a
                    password reset.
                  </Meta>
                )}
              </div>

              {user.emailVerified ? null : (
                <form action={resendVerificationAction}>
                  {/*
                   * A text button, like every other secondary control here —
                   * and deliberately so. This was filled for a while, on the
                   * argument that a resend is what the banner has been
                   * pointing at, and it went back on Nikolay's call. The text
                   * variant is the decision made *after* that round, not the
                   * state that preceded it.
                   *
                   * §8.5.5's one filled button belongs to Save: this is
                   * something you do to the account, not the reason you opened
                   * the screen, and a second fill inside a card made the card
                   * shout at a page of quiet ones. Being findable is carried
                   * by the two things above it instead — the banner on every
                   * screen, and the ring this card wears when the banner is
                   * what sent you.
                   */}
                  <Button variant="text" type="submit">
                    Send me a confirmation code
                  </Button>
                </form>
              )}
            </div>

            {/* The rule is the divider only while the columns are stacked. Side
                by side they are two labelled things a gutter apart, which is
                what the gutter is for. */}
            <form
              action={changeEmailAction}
              className="flex flex-col gap-3 border-t border-hairline pt-6 sm:border-t-0 sm:pt-0"
            >
              <Field
                label="Change it"
                name="newEmail"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                hint={
                  user.emailVerified
                    ? "We'll email your current address to approve the change. Nothing changes until you do."
                    : "We'll send a confirmation link to the new address."
                }
                required
              />
              <div>
                <Button variant="text" type="submit">
                  Change email
                </Button>
              </div>
            </form>
          </div>
        </Card>

        {/* ── Password ─────────────────────────────────────────────────────
         * `gap-4`, not the `gap-6` this had while it was a form. Emailing a
         * link left it a sentence and a control, which is the shape Google,
         * Appearance, Billing and Signing out all have — so it takes their
         * spacing too and the row it sits in comes out level.
         */}
        <Card className="rise flex flex-col gap-4" style={stagger(3)}>
          <Title>Password</Title>

          {hasPassword ? (
            /*
             * No current-password field, and no new one: this sends a link and
             * the choosing happens on `/reset-password`. See the note on
             * `emailPasswordLinkAction` for why the inbox is the safer place
             * for it than a page a borrowed session can already reach.
             */
            <form
              action={emailPasswordLinkAction}
              className="flex flex-col gap-4"
            >
              <Meta>
                We&rsquo;ll email you a link for choosing a new one. Following
                it signs you out everywhere, including here, so you sign back in
                with the new password.
              </Meta>

              <div className="border-t border-hairline pt-4">
                <Button variant="text" type="submit">
                  Email me a link
                </Button>
              </div>
            </form>
          ) : (
            <form
              action={setPasswordAction}
              className="flex flex-col gap-6"
            >
              {/* An account that arrived through Google has no password at all.
                  Setting one is what makes disconnecting Google possible. */}
              <Meta>
                You signed in with Google, so this account has no password yet.
                Set one and you can sign in either way, and disconnect Google
                later if you want to.
              </Meta>

              <Field
                label="New password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                required
              />

              <div>
                <Button variant="text" type="submit">
                  Set a password
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* ── Connected accounts ─────────────────────────────────────────── */}
        {googleEnabled() ? (
          <Card className="rise flex flex-col gap-4" style={stagger(4)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Title>Google</Title>
              {hasGoogle ? (
                <Status tone="verified">Connected</Status>
              ) : (
                <Status tone="neutral">Not connected</Status>
              )}
            </div>

            {hasGoogle ? (
              <form action={unlinkGoogleAction} className="flex flex-col gap-4">
                <Meta>
                  {hasPassword
                    ? "You can still sign in with your email and password."
                    : "Set a password first, or you would have no way to sign in."}
                </Meta>
                <div className="border-t border-hairline pt-4">
                  <Button variant="text" type="submit" disabled={!hasPassword}>
                    Disconnect Google
                  </Button>
                </div>
              </form>
            ) : (
              <form action={linkGoogleAction} className="flex flex-col gap-4">
                <Meta>Sign in with one tap instead of a password.</Meta>
                <div className="border-t border-hairline pt-4">
                  {/* The branded variant here too: this starts the same OAuth
                      handoff as the sign-in screen, so it should look like the
                      control the person already recognises from it. Disconnect
                      stays a text button — it is the subordinate action, and it
                      is leaving Google, not going there. */}
                  <Button variant="social" type="submit">
                    <GoogleIcon />
                    Connect Google
                  </Button>
                </div>
              </form>
            )}
          </Card>
        ) : null}

        {/* ── Appearance ─────────────────────────────────────────────────
         * §8.5.4 specifies "Settings → Appearance, as a three-way toggle
         * group". System leads because most people already made this choice at
         * the OS level; the other two are for overriding it in one direction
         * for one device, which is the only reason to touch this at all.
         */}
        <Card className="rise flex flex-col gap-4" style={stagger(5)}>
          <Title>Appearance</Title>
          <Meta>
            Follows your device unless you tell it otherwise. Applies to this
            browser, and to the emails we send you.
          </Meta>
          <div className="border-t border-hairline pt-4">
            <ThemeToggle onChoose={rememberThemeAction} />
          </div>
        </Card>

        {/* ── Billing ────────────────────────────────────────────────────── */}
        <Card className="rise flex flex-col gap-4" style={stagger(6)}>
          <Title>Plan and billing</Title>
          <Meta>
            What you are on, how much graded work is left this month, and how to
            change or stop it.
          </Meta>
          <div className="border-t border-hairline pt-4">
            <ButtonLink href="/account/billing" variant="text">
              Go to billing
            </ButtonLink>
          </div>
        </Card>

        {/* ── Sessions ───────────────────────────────────────────────────── */}
        <Card className="rise flex flex-col gap-4" style={stagger(7)}>
          <Title>Signing out</Title>
          <Meta>
            If you think someone else has your password, sign everything out and
            then change it.
          </Meta>
          {/*
           * Forms, not links: signing out is a state change, and a GET that
           * ends a session is one prefetch away from ending it by accident.
           *
           * This is the only sign-out in the product. It used to sit in the app
           * header, which the responsive shell would now render twice — once in
           * the mobile bar and once in the desktop rail — so it moved to the
           * screen the "You" destination already points at.
           */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-hairline pt-4">
            <form action={signOutAction}>
              <Button variant="text" type="submit">
                Sign out
              </Button>
            </form>
            <form action={signOutEverywhereAction}>
              <Button variant="text" type="submit">
                Sign out everywhere
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </AppFrame>
  );
}
