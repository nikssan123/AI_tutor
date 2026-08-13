import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAuth, googleEnabled, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { requireUser } from "@/lib/account/session";
import {
  MAX_HANDLE_LENGTH,
  MAX_NAME_LENGTH,
  MIN_HANDLE_LENGTH,
} from "@/lib/account/profile";
import {
  Button,
  Card,
  Meta,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import {
  changeEmailAction,
  changePasswordAction,
  linkGoogleAction,
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
 * It is a task screen, so it keeps the narrow column (§8.5.9) and one card per
 * concern. Every form posts to a Server Action and the result comes back as a
 * sentence in the query string, which is what lets the whole page work with no
 * client JavaScript at all — including on the day a bundle fails to load, which
 * is exactly the day someone needs to change a password.
 */
export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

/** The provider id Better Auth writes for an email-and-password account. */
const CREDENTIAL = "credential";
const GOOGLE = "google";

type Props = { searchParams: Promise<{ ok?: string; error?: string }> };

const input =
  "min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink placeholder:text-ink-faint focus:border-accent transition-colors duration-[var(--dur-fast)]";

const fieldLabel = "text-[length:var(--text-label-size)] font-[650] text-ink";

export default async function AccountPage({ searchParams }: Props) {
  const user = await requireUser();
  const { ok, error } = await searchParams;

  const accounts = await getAuth().api.listUserAccounts({
    headers: await headers(),
  });
  const providers = new Set(accounts.map((account) => account.providerId));
  const hasPassword = providers.has(CREDENTIAL);
  const hasGoogle = providers.has(GOOGLE);

  // Rendered as a datalist rather than a select: the platform's own tz database
  // is the only correct list, it has ~400 entries, and a type-ahead over all of
  // them beats a dropdown nobody can scroll — with no script either way.
  const zones = Intl.supportedValuesOf("timeZone");

  return (
    <AppFrame width="narrow">
      {/* No facts row: every card below carries its own state, and a header
          that repeated "Confirmed" would be saying it twice on one screen. */}
      <AppHeader title="Account" lead="Your details, and how you sign in." />

      {/* The outcome of whatever was just submitted. One line, at the top,
          where the eye already is after a form post. */}
      {ok ? <Status tone="verified">{ok}</Status> : null}
      {error ? <Status tone="problem">{error}</Status> : null}

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-6" style={stagger(1)}>
        <Title>Profile</Title>

        <form action={updateProfileAction} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className={fieldLabel}>
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={user.name}
              maxLength={MAX_NAME_LENGTH}
              required
              className={input}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="handle" className={fieldLabel}>
              Handle
            </label>
            <Meta>
              Optional and public. It appears in the web address of any Proof
              Page you publish. Letters, numbers and hyphens,{" "}
              {MIN_HANDLE_LENGTH}–{MAX_HANDLE_LENGTH} characters.
            </Meta>
            <input
              id="handle"
              name="handle"
              defaultValue={user.handle ?? ""}
              maxLength={MAX_HANDLE_LENGTH}
              placeholder="nikolay"
              className={input}
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor="timezone" className={fieldLabel}>
                Timezone
              </label>
              <Meta>Decides which day your work counts towards.</Meta>
              <input
                id="timezone"
                name="timezone"
                defaultValue={user.timezone}
                list="timezones"
                required
                className={input}
              />
              <datalist id="timezones">
                {zones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor="locale" className={fieldLabel}>
                Language
              </label>
              <Meta>A code like en or en-GB.</Meta>
              <input
                id="locale"
                name="locale"
                defaultValue={user.locale}
                required
                className={input}
              />
            </div>
          </div>

          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>

      {/* ── Email ────────────────────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-6" style={stagger(2)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Title>Email</Title>
          {user.emailVerified ? (
            <Status tone="verified">Confirmed</Status>
          ) : (
            <Status tone="attention">Not confirmed</Status>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className={fieldLabel}>{user.email}</span>
          {user.emailVerified ? (
            <Meta>
              We can send you a password reset if you ever need one.
            </Meta>
          ) : (
            <Meta>
              Until you confirm this address, we cannot send you a password
              reset.
            </Meta>
          )}
        </div>

        {user.emailVerified ? null : (
          <form action={resendVerificationAction}>
            <Button variant="text" type="submit">
              Send me a confirmation code
            </Button>
          </form>
        )}

        <form
          action={changeEmailAction}
          className="flex flex-col gap-3 border-t border-hairline pt-6"
        >
          <label htmlFor="newEmail" className={fieldLabel}>
            Change it
          </label>
          <Meta>
            {user.emailVerified
              ? "We'll email your current address to approve the change. Nothing changes until you do."
              : "We'll send a confirmation link to the new address."}
          </Meta>
          <input
            id="newEmail"
            name="newEmail"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            className={input}
          />
          <div>
            <Button variant="text" type="submit">
              Change email
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Password ─────────────────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-6" style={stagger(3)}>
        <Title>Password</Title>

        {hasPassword ? (
          <form action={changePasswordAction} className="flex flex-col gap-6">
            <Meta>Changing it signs out every other device.</Meta>

            <div className="flex flex-col gap-2">
              <label htmlFor="currentPassword" className={fieldLabel}>
                Current password
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                className={input}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="newPassword" className={fieldLabel}>
                New password
              </label>
              <Meta>At least {MIN_PASSWORD_LENGTH} characters.</Meta>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                className={input}
              />
            </div>

            <div>
              <Button variant="text" type="submit">
                Change password
              </Button>
            </div>
          </form>
        ) : (
          <form action={setPasswordAction} className="flex flex-col gap-6">
            {/* An account that arrived through Google has no password at all.
                Setting one is what makes disconnecting Google possible later. */}
            <Meta>
              You signed in with Google, so this account has no password yet.
              Set one and you can sign in either way, and disconnect Google
              later if you want to.
            </Meta>

            <div className="flex flex-col gap-2">
              <label htmlFor="newPassword" className={fieldLabel}>
                New password
              </label>
              <Meta>At least {MIN_PASSWORD_LENGTH} characters.</Meta>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                className={input}
              />
            </div>

            <div>
              <Button variant="text" type="submit">
                Set a password
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* ── Connected accounts ───────────────────────────────────────────── */}
      {googleEnabled() ? (
        <Card className="rise flex flex-col gap-6" style={stagger(4)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Title>Google</Title>
            {hasGoogle ? (
              <Status tone="verified">Connected</Status>
            ) : (
              <Status tone="neutral">Not connected</Status>
            )}
          </div>

          {hasGoogle ? (
            <form action={unlinkGoogleAction} className="flex flex-col gap-3">
              <Meta>
                {hasPassword
                  ? "You can still sign in with your email and password."
                  : "Set a password first, or you would have no way to sign in."}
              </Meta>
              <div>
                <Button variant="text" type="submit" disabled={!hasPassword}>
                  Disconnect Google
                </Button>
              </div>
            </form>
          ) : (
            <form action={linkGoogleAction} className="flex flex-col gap-3">
              <Meta>Sign in with one tap instead of a password.</Meta>
              <div>
                <Button variant="text" type="submit">
                  Connect Google
                </Button>
              </div>
            </form>
          )}
        </Card>
      ) : null}

      {/* ── Sessions ─────────────────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-4" style={stagger(5)}>
        <Title>Signing out</Title>
        <Meta>
          If you think someone else has your password, sign everything out and
          then change it.
        </Meta>
        {/*
         * Forms, not links: signing out is a state change, and a GET that ends
         * a session is one prefetch away from ending it by accident.
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
    </AppFrame>
  );
}
