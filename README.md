# Mio

A personal assistant you can text. Mio uses one shared number with private owner-scoped memory, conversation history and requested reminders. Its Next.js companion includes Today, Notes, Reminders, Activity and Settings. See [docs/BETA.md](docs/BETA.md) for rollout, [docs/SMS.md](docs/SMS.md) for transport and [docs/USAGE.md](docs/USAGE.md) for admission limits and cost reservations.

## Run locally

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Set `APPWRITE_API_KEY` to a server-only key with `users.read`, `users.write`, and `sessions.write`. Set `APP_URL` to the exact local origin, including the port. The checked-in example contains the public Mio project/resource IDs, never credentials. Add your hostname as an Appwrite Web platform when using another origin.

## Appwrite resources

`appwrite.config.json` records database `mio`, the `notes`, `attachments`, and server-controlled `sms_*` tables, the existing attachment bucket, and the SSR Site `mio-web`.

```sh
appwrite login
appwrite push table --all --force
appwrite push bucket --all --force
pnpm appwrite:generate
```

Table creation grants authenticated users create access. Each row and file receives permissions for its owner only; row security and file security are enabled. Application data access uses the signed-in user's session, with additional owner checks in the service layer. The authentication key does not have database or storage scopes.

The existing bucket was empty before configuration. It accepts PDF, PNG/JPEG/WebP, TXT, and Markdown files up to 10 MiB. Note deletion removes its files and metadata before deleting the note, so failed cleanup remains recoverable. Upload failures inspect deterministic record IDs before attempting compensation.

The CLI generates row types in `lib/generated/appwrite.ts`. `lib/notes.ts` supplies typed SDK adapters to the framework-independent notes service. We deliberately use user-session clients rather than a generated singleton with an administrative API key.

## Accounts and routes

- `/`: landing page with an explicitly labeled interactive example.
- `/auth`: signup, signin, and current-account signout.
- `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify`: recovery and verification flows, with explicit form submission and trusted callback URLs from `APP_URL`.
- `/onboarding`: meet Mio, explicit SMS consent and one-tap Messages pairing.
- `/today`: upcoming reminders and recent notes; the post-sign-in home.
- `/reminders`: upcoming/history, exact notification times, revision-aware edit/cancel.
- `/activity`: factual SMS transcripts and current owned note references.
- `/settings`: time preferences, quiet hours, usage and account access.
- `/settings/sms`: connection management and disconnection.
- `/privacy`, `/terms`, `/sms-terms`: public policies and the consent disclosure.
- `/dashboard`: authenticated notes, title search (three characters minimum), cursor pagination, archive/restore, and attachments.
- `/api/attachments/:id`: authenticated download with ownership checks and no-store responses.

The Appwrite SDK handlers manage SSR session cookies. Authentication POST requests require the configured origin. Secrets stay in server environment variables. Email verification is available but is not required to write notes.

## Deploy to Appwrite Sites

```sh
pnpm appwrite:deploy
```

The deployment script stages only application sources and required package/configuration files into ignored `.appwrite/site`; local environment files and provisioning credentials are excluded. Set `MIO_INVITE_EMAILS` on both Site and Function; an empty list denies new signup and assistant access. Set public `MIO_SUPPORT_EMAIL` and `MIO_OPERATOR_NAME` on the Site. Set Site variables `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `APP_URL`, `APPWRITE_ATTACHMENTS_BUCKET_ID`, and secret `APPWRITE_API_KEY`. The database and table IDs have validated defaults or can be overridden through the variables in `.env.example`.

Current Site: https://6ac511fd00064c0f429d.appwrite.network

CLI deployments stage a source allowlist. Verify the current provider deployment and Git integration before relying on automatic deployment.

## Verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm appwrite:verify
pnpm sms:verify
```

Live verification requires an ignored `.env.provisioning` containing a privileged `APPWRITE_PROVISIONING_KEY`. It creates isolated temporary accounts/data, exercises raw Appwrite permission checks, and removes only the resources it created. Keep that key out of the application runtime.

See [docs/QA.md](docs/QA.md) for observed evidence and remaining acceptance gates.
