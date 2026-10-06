# Mio verification

## Live Appwrite permissions

Ran `node scripts/verify-appwrite.mjs` against Appwrite Cloud on
**2026-10-06 at 15:28:59 UTC**. All **35 checks passed**, with no cleanup failures.
This is live provider evidence using real API requests; it is separate from unit
tests, browser behavior, and deployed application acceptance.

Resources checked:

- Project: `68d13a4a000d854004b3` (`Mio`), NYC endpoint.
- TablesDB database: `mio`; tables: `notes` and `attachments`.
- Attachment bucket: `68d143bf001b9a793c30`.

Observed results:

- Both live tables have available columns and indexes matching
  `appwrite.config.json`, row security enabled, and only authenticated-user
  create permission at table level.
- The bucket has file security enabled, only authenticated-user create
  permission, and the configured file extensions, size limit, encryption,
  antivirus, and compression settings.
- The runtime authentication key can create email/password sessions for the two
  synthetic test accounts. It receives HTTP 401 when attempting TablesDB table
  administration or Storage bucket administration. These checks establish those
  two restrictions; exact key scopes are managed separately in provisioning.
- User A creates and reads an owner-only note through a session client, edits
  its body, archives it, searches its title with the full-text index, filters
  archived/active records, and restores it.
- User B and an unauthenticated guest cannot get, update, delete, or list that
  note. These are direct SDK requests without the application's ownership
  filters. Read returns HTTP 404; update/delete return HTTP 401; list results
  omit the private row.
- User A uploads a text attachment, creates its linked metadata, lists the
  metadata, and downloads the exact original bytes.
- User B and a guest cannot get, update, delete, or list the attachment metadata,
  or download, delete, or list its file. Reads/downloads return HTTP 404;
  mutations return HTTP 401; lists omit the private resources.
- A guest cannot create a note (HTTP 401).
- User A deletes its file, metadata, and note. Deleting its session prevents
  subsequent authentication (HTTP 401).
- The script removes the two disposable accounts, which also removes their
  remaining sessions. All attempted disposable UUIDs are inspected during
  cleanup; pre-existing users and data are outside its cleanup scope.

To repeat, supply the local ignored `.env.local` runtime settings and
`.env.provisioning` containing `APPWRITE_PROVISIONING_KEY`, then run the command
above from the repository root. The provisioning key is used only for schema
inspection, disposable account setup, and cleanup. All feature and permission
checks use per-user session clients or a guest client. The script sends no email
and prints no credentials.

Creates are attempted once with deterministic UUIDs allocated before mutation.
On an uncertain response, cleanup inspects those exact IDs rather than replaying
the mutation. Cleanup refuses deletion when disposable ownership does not match
and reports the resource ID if cleanup fails.

## Local application checks

On 2026-10-06, `pnpm lint`, `pnpm typecheck`, `pnpm test` (17 tests),
`pnpm build`, and `git diff --check` passed. Tests cover ownership, input
validation, cursor pagination, uncertain upload reconciliation, cleanup failures,
and authentication request limits with and without Content-Length.

The collaborative browser exercised landing-to-signup, SSR dashboard access,
create/edit/save, title search, archive/restore, file upload, and exact-byte
private download. A note-save issue caused by the unsaved-change guard treating
the editor form as a GET search form was corrected by explicitly using POST.
The corrected flow was verified locally and on Appwrite Sites.

Landing and dashboard were inspected at 1280x800 and 390x844. No horizontal
page overflow was observed. Full landing and lower attachment captures were
also inspected. The independent design review found one material contrast
issue; the placeholder now uses `#627087` (5.02:1 on white), and the reviewer
scored that fix resolved. Review scope was the user-approved code-led direction;
no separately generated mockup or visual quality board was used. DESIGN.md
records the actual implemented system.

## Hosted application checks

The Appwrite Site at `https://6ac511fd00064c0f429d.appwrite.network` was
built remotely and activated through the Appwrite CLI. Browser checks confirmed
sign-in, loading notes previously saved locally, creating a new note through
the hosted dashboard, and persistence after a full page load. Signout revoked
workspace access and `/dashboard` redirected to `/auth`. Note deletion removed
its associated attachment. An oversized authentication request returned 413.
Recovery for an unknown synthetic address returned a generic response; an
incomplete verification link displayed a recoverable error.

## Remaining acceptance gates

- Actual verification/recovery email delivery and successful completion with
  inbox tokens were not exercised. No email was sent to a real person.
- A custom domain and Git auto-deploy are not configured. The checkout has no
  Git remote; the Appwrite-generated hostname and CLI deployments work.
- Physical mobile-device behavior was not tested; browser viewport checks are
  separate evidence.

Hosted attachment upload returned an owner-only file; its protected download
returned the exact `Hosted Mio file check` text. Authentication POST without
Origin returned 403. Deployment uploads were inspected: the staged allowlist
contains no `.env*` files.

Pre-SMS active deployment: `6ac5165f63287582ae0e` (remote build ready, 46 seconds).
The Site reports that deployment as active; an HTTPS request returned 200 and
`x-appwrite-deployment-id: 6ac5165f63287582ae0e`.

After final deployment activation, browser sign-in succeeded, the saved note
loaded, the placeholder correction was present, and no new console errors were
observed during that check. Signout succeeded with the final bounded request
handler. The hosted attachment deletion was confirmed by its disappearance
from the note.

Browser QA cleanup removed its one disposable account and two remaining notes;
attachment records were already removed by the tested deletion flows. The
account lookup returned zero afterward. Pre-existing users were preserved.

## Phase 1 SMS Inbox snapshot — 2026-10-06

This historical snapshot is superseded by the conversational assistant
acceptance below. Its transport and connection evidence remains relevant.

Phase 1 is implemented and deployed using TablesDB, an Appwrite Function,
the existing Twilio Messaging provider, owned user targets, and Realtime.
Reminders, SMS retrieval, and actions are not implemented. Reminder-shaped
texts remain notes and replies explicitly disclose that alerts are not scheduled.

Local lint/typecheck, the Function build, and all **23 unit tests** passed.
The full web build passed locally and on Appwrite Sites. The existing **35 live
Appwrite permission/attachment checks** passed after the additive SMS schema
changes. `git diff --check` passed.

The SMS verifier passed **7 live Cloud checks** with a short-lived API key
matching the deployed Function scopes. All verifier messages were drafts.
Checks cover code rotation, existing target ownership, private/server-controlled
rows, concurrent duplicate capture, lost commit/reply responses, replay after
note deletion, changed payload rejection, and disconnect cancellation.
Another user's existing SMS target is never reassigned or used for a reply.

A disposable hosted browser account verified automatic connection status and
note-list updates, SMS provenance, and preservation of unsaved editor text.
The settings/dashboard were checked at 390x844 without horizontal page
overflow. A subsequent Site deployment made that already-open QA tab's old
Server Action requests return 404; the tab displayed its recovery message.
This is separate from the real user's final-deployment acceptance below.

Genuine phone-originated acceptance used the user's confirmed phone ending
1711 and the shared Mio/Vapi number ending 6565:

- The first two connection attempts reached Twilio but returned Function 401:
  `users.write` was missing. The live scope configuration was corrected, and
  the verifier now exercises the exact Function scopes rather than using
  provisioning permissions for workflow operations.
- A temporary outbound QA target also reserved the real phone identifier.
  That target was removed after delivery. Target conflicts now reuse only a
  matching target already owned by the verified account; another owner's
  target produces a clear connection failure without binding or sending.
- An administrative recovery code was replaced before it was delivered.
  The rejected inbound request returned 200 with a real Twilio SMS explanation.
  The next recovery code was checked against the active challenge before
  sending. Temporary recovery targets were removed after delivery.
- Inbound `SM15b8e5b5435c6bef75927cec3ddde87a` connected the user's phone on
  **2026-10-06 at 16:27:44 UTC**. The Function returned 200 and persisted an
  owner-readable connection and server-only receipt. Appwrite Messaging
  reported `sent`, delivered total 1, with no delivery errors. Twilio reply
  `SM67c2b37f789ec51006c6604fb15e624a` reported **delivered**.
- Inbound `SM8d0c9aa04668f813118b133afaad20af` captured the user's next text
  at **16:28:14 UTC**, with original body, `source=sms`, and read/update/delete
  permission only for that user. The receipt was queued once. Appwrite reported
  `sent`, delivered total 1, with no errors; Twilio confirmation
  `SM0b0c6fbe398845b2209661cae2490c91` reported **delivered**.
- The user confirmed **“its working”** and that the note appeared in their
  open Inbox **automatically, without refreshing**. This is user-reported
  real-device/UI acceptance, distinct from the synthetic browser check.

The shared number's voice URL and status callback remain Vapi's original
values; only SMS routing changed. Unconnected senders are forwarded to the
original Vapi SMS endpoint with a recomputed Twilio signature. A genuine
unconnected-sender Vapi SMS conversation and a physical voice call were not
tested; preservation of their configuration is verified.

Backend authorization failures on inbound callbacks now return retryable
503 responses. A regression test verifies that invalid signatures still
return 403 and invalid settings sessions return 401.

Final Site deployment: `6ac51d8b70517f8a74ff`; HTTPS returned 200 with that
exact `x-appwrite-deployment-id`. Final Function deployment:
`6ac5223de5bf7d7b0fc4` (remote build ready and active at 16:31:30 UTC), including
target-conflict handling and reminder disclosure.

Cleanup removed only the disposable SMS browser user's two notes, two receipts,
connection, draft replies, readiness message, targets, sessions, and account.
Its attachment count was zero. All scoped-verifier fixtures were removed.
The real user's account, connection, owner-only note, and acceptance receipts
were re-read and preserved after cleanup. No phone numbers, connection codes,
note bodies, or credentials are included in this report.

## Conversational SMS assistant acceptance — 2026-10-06

The additive schema and assistant are deployed. The active Function deployment
is `6ac53237be422231bc21`, with a ready remote TypeScript build. The active Site
deployment is `6ac52c8c6b5abeaccdd3`. The Function uses
`openai/gpt-5.6-luna` through OpenRouter and AI SDK 7. Its OpenRouter key is a
secret Function variable; no key is included in source, configuration or archives.
The shared Twilio/Vapi routing and existing Function scopes are preserved.

Local lint, type checking, Function build, Next.js production build and
`git diff --check` passed. The regular suite passed **48 tests**, with the one
paid evaluation test skipped. Tests cover actual SDK tool loops, follow-up edits,
search/deletion, ambiguous deletion, note/reminder ownership, separate event and
notification times, time-only corrections preserving dates, IANA/DST conversion,
partial inference rollback, duplicates, lost responses, revocation, native
scheduling races and web note cancellation. Regular tests make no paid requests.

The opt-in evaluation passed a **13-turn real Luna corpus** against isolated
in-memory persistence and Messaging. It exercises Shiplog create/edit/read/delete,
work time/offset corrections and cancellation, tomorrow morning/time correction,
preservation of tomorrow during a work-time correction, and ambiguous deletion.
Earlier evaluation failures exposed ambiguous deletion and date-drift risks;
server-side guards now enforce those boundaries. Malformed tool calls abort the
entire turn and use durable retries rather than committing a partial plan.

All **8 live Cloud SMS checks** passed using an ephemeral key with exactly the
Function scopes. Messages were drafts and production workers ignored fixture
jobs. The additional reminder check verifies owner-only reads, forbidden client
writes/foreign reads and cancellation through a real fenced transaction. All
**35 Appwrite permission/attachment checks** also passed after schema evolution.
Fixtures were cleaned without modifying pre-existing accounts or connections.

Deployed signed callback simulation completed a Shiplog-style
create → edit → retrieve → delete cycle on the same note. A subsequent combined
reminder corpus was interrupted by genuine handset turns changing the active
conversation, so that combined run is not claimed as passing. The replacement
proactive-only check used a uniquely marked disposable note and passed:

- Accepted callback: `SM35b49e50024dac3b302fed1b5c066fe2`.
- Durable reminder: `r_098b0f5b506231dbca95f22fc992b005`.
- Native scheduled message: `m_becc00d4683660a55734689e81b2bf0a`, scheduled
  for **2026-10-06 at 17:25:00 UTC**, subsequently Appwrite `sent`.
- Twilio message `SM62b427525e98f695d6e61924c39508b8` reported **delivered**,
  with no carrier error. Actual handset observation of this reminder is separate.

Twilio records also confirm three genuine phone-originated assistant turns:
`SM31c0af4508dd7fbbd17706fe86c02269`,
`SM9b4f820aed24cabb249bfd78b569abf9`, and
`SM603e369a2576ed87bf42fb118b880732`. Their jobs completed and replies queued.
This is distinct from administrative callback simulation.

The successful proactive fixture note was removed; its durable receipt/turn and
sent reminder tombstone remain. The earlier QA reminder was canceled to avoid
an unintended later test notification. The user's edited QA work note and open
editor were preserved. Cleanup inspected known fixture IDs rather than replaying
uncertain mutations.

The deployed SMS settings page was inspected at 1280x800 and 390x844 in a separate
collaborative tab. It displays the assistant behavior, configured
`America/Chicago` timezone, 15-minute default offset and AI privacy disclosure.
At mobile width 390, page scroll width was 383: no horizontal overflow. The
user's existing dashboard/editor tab was not changed by this check.

TablesDB reminder intent is atomic; native Messaging synchronization is a durable
reconciliation saga. A message already processing at the carrier cannot be
recalled. Provider delivery evidence does not prove physical-device rendering.
See [SMS.md](SMS.md) for lifecycle, deployment and operational details.

## Web beta implementation — 2026-10-06

This section covers the local beta changes after `1cd170f`. The earlier Cloud
and carrier results above concern the previous deployed implementation; they do
not verify these beta changes. No Cloud schema, Function, Site, Twilio routing,
registration, account, invitation or outbound-message changes were performed.

Local lint, TypeScript checking, SMS Function compilation, Next.js production
build and `git diff --check` passed. The regular suite passed **104 tests** with
the one paid evaluation skipped (105 total). Added coverage includes consent
versioning, verified-email invite admission, owner-scoped companion APIs, optimistic reminder
revisions, lost-response reconciliation, quiet hours, atomic per-user/global
usage reservations, token accounting and HELP behavior. Regression tests cover
revoked email verification, SMS-disabled reply suppression, reminder-event recursion and immediate recall
of more than five pending native schedules on disconnect. The prepared Site
archive also completed a local production build, including its shared invite
policy import.

The collaborative browser inspected the real local production landing and
public legal pages at 390px. They show Drew Sepeczi and
`drewsepeczi@gmail.com`; protected routes redirect signed-out visitors. A
same-origin noninvited signup request returned 403 without creating an account.

Authenticated browser QA used an isolated copy of the production build and an
in-memory Appwrite API fixture. All five companion routes returned fixture
content. Today, Notes, Reminders, Activity, Settings and onboarding were inspected
at 390px, with Activity and Reminders also inspected at 1280px. Long titles,
messages and transcripts wrapped without horizontal overflow. Reminder editing
saved the new message and closed its editor; cancellation removed the reminder
from Upcoming and displayed it in History. Preference saving persisted a new
default offset. Onboarding moved from Meet Mio to Connect Phone, with consent
initially unchecked and Open Messages disabled until consent was selected.
The browser did not open Messages or send a pairing text.

These fixtures made no Cloud requests and cannot verify Cloud permissions,
Realtime, native Messaging reconciliation or handset behavior. Realtime was
intentionally unavailable, and the app displayed its Refresh fallback. Unit and
integration tests exercise the real business logic against isolated persistence;
the browser fixture verifies rendering and interaction only. Live two-account
and phone acceptance remains required after the activation steps in
[BETA.md](BETA.md).

Independent review reproduced invitation impersonation through an unverified
allowlisted email. The fix requires verified email ownership at pairing, API
admission and every assistant/send revalidation. Regression tests reject
unverified token requests, pairing after verification loss, companion calls and
queued AI/replies after verification loss. Onboarding reuses the existing email
verification flow before phone setup. An unverified local fixture redirected
from Today to the verification screen at 390px, with no pairing action or
horizontal overflow. No verification email was sent during QA.
