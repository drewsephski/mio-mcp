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

Final active deployment: `6ac5165f63287582ae0e` (remote build ready, 46 seconds).
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
