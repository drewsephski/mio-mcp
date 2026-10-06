# Mio operations

This is the authoritative release runbook. README links here. SMS.md describes
transport behavior; USAGE.md describes reservation semantics; QA.md records
historical evidence, not current deployment instructions.

## Local development

Use Node 22 and pnpm 10.33.2. `pnpm install --frozen-lockfile`, copy `.env.example`
to `.env.local`, configure the server auth key, and run `pnpm dev`. The auth key
requires users.read, users.write and sessions.write; it must not have database or
storage administration scopes. Never expose it to browser/mobile bundles.

`pnpm check:config && pnpm lint && pnpm typecheck && pnpm test && pnpm sms:build && pnpm build && pnpm mobile:typecheck && pnpm mobile:export`
is the deterministic web/Function validation path. No provider credentials or
paid generation are required. CI supplies a build-only auth placeholder. The
paid Luna evaluation remains opt-in via `pnpm sms:evaluate`.

## CI

`.github/workflows/ci.yml` runs on every PR and main push, with read-only GitHub
permissions, frozen dependencies, configuration consistency, lint, TypeScript,
all deterministic tests, Function/web builds, and mobile typecheck/export. Live
checks run only through explicitly invoked local operational commands. Require
`Lint, types, tests and production builds` in branch protection in GitHub; the
repository cannot enforce that organization setting from a workflow file.

## Credentials and beta configuration

An ignored `.env.provisioning` supplies `APPWRITE_PROVISIONING_KEY` for deployment,
DDL, users, variables, executions, Storage inspection and schema inspection.
`appwrite login` supplies console policy permissions. API and console permissions
are independent. CLI 28.1.0 or compatible is required for generation/policies.
Never print keys or raw provider errors. Set in `.env.local`:

- `MIO_INVITE_EMAILS`: exact comma-separated invited emails, same policy on Site
  and Function. The release refuses removal of an existing connected user.
- `MIO_OPERATOR_USER_ID`: exact active verified invited Appwrite user ID.
- `MIO_SUPPORT_EMAIL`, `MIO_OPERATOR_NAME`: public legal/support identity.
- `MIO_OPERATIONS_TOKEN`: independent random secret, at least 32 characters, for
  readiness endpoints. Store securely; never send it to ordinary clients.
- Limits documented in `.env.example` / USAGE.md; defaults are bounded. A zero
  global budget closes its circuit breaker. Per-operation cost ceilings must be
  positive. They are reservations, not invoices.

Existing provider/auth secrets must already exist on their runtime resource.
The release updates only named beta variables and never replaces the remote
variable set. Provisioning credentials are excluded from deployment archives.

## Beta release

`pnpm release:beta -- --preflight` validates configuration and all deterministic
checks without mutation. `pnpm schema:beta` inspects schema drift read-only.
`pnpm launch:check` reports provider readiness separately, including whether each
prerequisite is operator-attested or machine-verified.

`pnpm release:beta` is the sole supported production deployment path. Legacy
`appwrite:deploy` and `sms:deploy` aliases now route through it. Disable independent
Site/Function Git auto-deploy. Do not use bare `appwrite push` to deploy production.

The command validates first, builds both applications, validates external
readiness, preserves verified invited users with the `mioBeta` label, applies
public account policy, inspects and converges schema, waits for every column and
index, records an immutable schema version, regenerates types, rebuilds, updates
selected variables, deploys and activates Function, verifies its runtime release
and schema, then deploys Site and verifies both through authenticated endpoints.
It also checks public product/legal routes and launch readiness again. A changing
source fingerprint stops the release; do not edit the checkout during release.

The deterministic identity combines the base commit SHA and a digest of shipped
sources/config/lockfile. It therefore identifies uncommitted builds precisely.
Both archives contain the same generated identity and schema contract, independent
of environment-variable overrides. `/api/ready` requires Bearer operations token;
Function `/ready` requires `x-mio-operations-token`. Neither exposes private rows,
phone numbers, credentials or environment values. `pnpm release:verify` compares
repo, runtime Site, runtime Function and live schema and exits nonzero on drift.
The Site passes its build identity on companion calls; an incompatible Function
rejects those calls until the coordinated deployment completes.

Schema changes are additive and versioned. Missing columns/tables/indexes can be
created. Outdated column shape, unexpected columns/indexes, failed DDL, and
non-permission bucket changes stop the release for a reviewed migration. Never
silently delete or narrow production columns. A changed schema contract must
increment `SCHEMA_VERSION`; a recorded version/digest cannot be overwritten.

`.workflow/release-latest.json` records every stage and old/new deployment IDs.
The server-only `releases` table records stages once schema converges. A local
exclusive lock prevents overlap in this checkout. A server-only deployment_lock
row prevents concurrent policy/schema/code/variable deployment across hosts after
bootstrap. Release rechecks the active deployment pair after acquiring it. Initial schema
bootstrap must run on one host; additive DDL uncertainty always stops. If a
process dies holding a lock, inspect its release/deployment IDs and delete only
that exact lock after confirming no release is active.
An uncertain upload/build/activation stops without automatic replay. Inspect its
exact deployment ID and the durable ledger, then use a fresh build identity or
explicit recovery; do not blindly retry the same release command.

Success is reported only after `repo = schema = Function = Site` verification.
A partial deployment remains visible as a failure. Runtime readiness is
operational compatibility, not carrier, inbox or physical-device acceptance.

## Admission

Public Account signup is closed by a project user limit of 1 once this existing
project has users. Existing accounts remain active. Web invited signup uses the
server Users API, which is not the public Account endpoint and bypasses this
limit. Unused anonymous/phone/OTP/magic-link account paths are disabled. Native
email/password session creation remains enabled.

Account existence is not admission. Server-created labels grant create permission
on notes, attachment metadata and files. Existing rows/files keep owner-only
permissions; SMS/reminder/usage rows remain server controlled and owner readable.
Only a server-verified invited account receives `mioBeta`. Normal application
services check invitation again; the Function independently checks verified
invited email before assistant admission. The operator uses exact configured
ID, active status and verification, on both Site and Function.

No platform hook is assumed on public account creation. If a policy is manually
relaxed, an external uninvited account can still have its own authentication,
profile and preferences, but cannot create Mio data, bind a phone or use the
assistant/operator APIs. It cannot read others' rows. Labels are durable admission;
removing an invite revokes application/SMS admission but does not delete already
owned data or silently revoke a user's historical owner permissions.

## Operator health

Sign in as the configured operator and visit `/operator`. It reads only selected
infrastructure fields, never note bodies, job bodies or conversation text.
Failures are allowlisted codes, not raw exception messages. Totals are exact
bounded beta scans; exceeding 20,000 rows fails instead of displaying partial
aggregates. Data arriving during a scan can change subsequent totals; refresh for
current state. No cached cross-user sessions exist.

`/api/operator/{userId}` is an explicit server-authorized support drill-down into
connection presence, first success timestamps, active days, limits and failure
counts. It does not expose content or phone values. Metric definitions are in
METRICS.md and the authorized `/operator/definitions` page.

## Rollback and partial releases

Do not undo additive schema or delete data as a routine rollback. Retain both
previous deployment IDs in the release receipt. `pnpm release:rollback` inspects
that pair; `pnpm release:rollback -- --apply` activates Function, requires its
readiness against the current schema, activates Site, then proves the pair
matches. Runtime variables remain in place. Restore old configuration only by
an explicit reviewed change.

A rollback pair must have a completed durable release record with the current
schema digest before any activation. The first versioned release's legacy
predecessor has no such record; automated rollback refuses it before changing
Function. Prefer fixing forward. For an emergency legacy rollback, the operator must inspect exact
compatibility and record it manually; it cannot be called a verified release.
Readiness must be red until repaired. Never deploy a newer Site to mask a failed
Function. Block admission/traffic operationally if a partial release is unsafe.

## First-user acceptance and mobile

Follow ACCEPTANCE.md for two separate accounts/phones and real handset evidence.
Follow LAUNCH.md for external provider confirmations. Follow MOBILE.md for the
isolated Expo companion. These gates remain distinct from CI and deployment.
