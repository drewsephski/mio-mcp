# Mio

A private assistant you text. The web companion is Today, Notes, Reminders,
Activity and Settings. SMS jobs, tool mutations, requested reminders, admission,
usage reservations and data isolation are enforced server-side in Appwrite.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Use Node 22 and pnpm 10.33.2. Configure the public project values and server-only
authentication key in `.env.local`; never copy that key into the mobile app.

- [Operations](docs/OPERATIONS.md): local development, CI, release, readiness, admission, operator health, partial deployments and rollback.
- [Release](docs/OPERATIONS.md#beta-release): `pnpm release:beta` is the only production deployment path; `pnpm release:verify` detects drift.
- [Launch prerequisites](docs/LAUNCH.md): dedicated SMS routing and externally confirmed Twilio/A2P requirements.
- [Two-user acceptance](docs/ACCEPTANCE.md): automated isolation checks and actual phone/handset evidence.
- [Metrics](docs/METRICS.md): reproducible first-party activation, quality and return-frequency definitions.
- [Mobile](docs/MOBILE.md): isolated Expo companion and future Share Sheet boundary.
- [SMS transport](docs/SMS.md) and [usage semantics](docs/USAGE.md): existing architecture and safeguards.
- [Historical verification](docs/QA.md): evidence snapshots, never a substitute for current readiness.

Production Site: https://6ac511fd00064c0f429d.appwrite.network
