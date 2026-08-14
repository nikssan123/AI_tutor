# Resend setup

Domain added and API key generated already. This is what is left.

## 1. Check the key can read, not just send

The inbound webhook carries metadata only, so the app fetches each message body
from `GET /emails/receiving/{id}`. A **sending-only key makes every inbound
message fail with a 502 and retry forever.** If the key is not full access,
make a new one.

## 2. Decide where mail is received

Mail is delivered to the lowest-priority MX and stops there, so the root can
only point at one place.

- **No human mailbox on the domain yet** → MX on `meritkeep.com`, support
  address `support@meritkeep.com`. **Recommended.**
- **You want Google Workspace on `meritkeep.com`** → add `inbound.meritkeep.com`
  as a second domain in Resend, MX on that, support address
  `support@inbound.meritkeep.com`.

No code changes either way — the app uses whatever `EMAIL_SUPPORT_FROM` says.

## 3. Add the receiving MX

Resend dashboard → your domain → the receiving section gives you one `MX`
record. Add it, and make sure **its priority is the lowest number of any MX on
that name** or mail goes elsewhere.

Receiving is catch-all, which threading depends on: replies come back to
`support+<threadId>@meritkeep.com` and the app reads the thread id out of the
address.

## 4. Add the webhook

**Webhooks → Add**, endpoint `https://meritkeep.com/api/email/inbound`, events:

- `email.received`
- `email.bounced`, `email.complained` — these mark the message failed on its
  thread, so a dead outreach address shows up in `/admin/mail` instead of
  looking like silence.

Copy the `whsec_` signing secret. Until it is set the endpoint refuses
everything: it writes to the database, so unsigned it would let anyone file a
support request from any address they chose.

## 5. Set the environment variables

```sh
RESEND_API_KEY=re_xxxx
RESEND_WEBHOOK_SECRET=whsec_xxxx

# Auth mail — verification, reset, email change. Nobody answers this one.
EMAIL_FROM="MeritKeep <hello@meritkeep.com>"

# The mailbox you watch. This is the one with the MX record.
EMAIL_SUPPORT_FROM="MeritKeep <support@meritkeep.com>"
```

`EMAIL_FROM` is required as soon as `RESEND_API_KEY` exists — the app throws at
the first send rather than guessing, because a guessed `from` on an unverified
domain is silently undelivered password resets.

## 6. Add DMARC if you have not

One `TXT` on `_dmarc.meritkeep.com`:

```
v=DMARC1; p=none; rua=mailto:dmarc@meritkeep.com
```

Nobody hands you this record and it decides whether Gmail trusts you. `p=none`
reports without rejecting; tighten later.

## 7. Check it

1. Email `support@meritkeep.com` from your phone → appears in `/admin/mail`
   marked *waiting on us* within seconds.
2. Answer it there → arrives in the same thread, `Reply-To` reads
   `support+<uuid>@meritkeep.com`.
3. Reply to that → lands back on the same conversation.

Nothing arriving? The webhook's delivery log shows what the app answered:

| Code | Cause |
|---|---|
| `401` | `RESEND_WEBHOOK_SECRET` does not match |
| `500` | The secret or the API key is unset |
| `502` | The key cannot read received emails — see step 1 |

You can test all of this before DNS propagates: Resend gives every account a
`<id>.resend.app` address that fires the webhook immediately.

---

## Two things deliberately not built

**Auth email is not stored.** A reset link is a credential; putting it in a
table `/admin/data` browses and `/admin/sql` queries turns a database read into
account takeover. `/admin/mail` holds correspondence with people, not the
machine's own mail.

**No unsubscribe link.** The outreach templates go to people with accounts and
each invites a reply, which is fine at this volume. It stops being fine the day
you send the same message to a *list* rather than to a person — that is
marketing mail and needs `List-Unsubscribe`, a suppression list and an
account-level preference. Ask for it as its own piece of work.
