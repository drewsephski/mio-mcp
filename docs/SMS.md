# Mio SMS Inbox

Phase 1 is a durable text inbox. Every text from a connected phone becomes a
private note, except connection, HELP, and opt-out controls. This version does
not schedule reminders, retrieve notes by SMS, or run AI. A reminder-shaped
text is saved with an explicit reply that no reminder was scheduled.

## Connect and capture

1. Sign in and open `/settings/sms`.
2. Generate a connection code and send the displayed `connect …` text to
   **+1 (224) 286-6565** from your phone within 15 minutes.
3. Mio binds that verified sender to your account and confirms the connection.
4. Text a thought. Mio preserves the original text in the body, derives a
   concise title, sets `source=sms`, and confirms `Saved to Inbox: “…”`.
5. The open dashboard receives owner-authorized Appwrite Realtime events and
   reloads only the notes list. An unsaved editor remains intact.

Codes contain 128 bits of randomness, are stored only as SHA-256 hashes, expire
in 15 minutes, rotate on regeneration, and are consumed in the same transaction
that establishes the binding. Only a signed-in user can create a code; only a
validated Twilio webhook can use it. A phone can belong to only one connection.
This verifies phone possession without changing the account's login methods.
The associated Appwrite user target pins SMS delivery to the existing provider.

## Shared Twilio/Vapi number

Twilio routes calls and SMS separately. Mio changes only `SmsUrl` and
`SmsMethod`. The voice webhook remains
`https://api.vapi.ai/twilio/inbound_call`, and the Vapi status callback remains
unchanged.

The SMS Function handles connected Mio senders and connection codes. Other
senders are forwarded to the previous `https://api.vapi.ai/twilio/sms` endpoint,
with the original form body and a signature computed for the upstream URL.
One sender's ordinary texts go to one system. A connected Mio sender must
explicitly disconnect to return to Vapi SMS. There is no duplicate fan-out to
two conversational systems.

The gateway is now in the availability path for Vapi SMS. If Vapi is unavailable,
Mio returns 503 so Twilio can retry. Voice does not pass through Mio. Vapi may
still control outbound SMS on this shared number; Twilio's STOP block applies
to the number, not only Mio. A Twilio dashboard change by another integration
can overwrite the SMS route, so recheck it when re-importing the number in Vapi.

## Durable state and authorization

- `notes`: existing row security and owner-only read/update/delete; additive
  optional `source` column, default `web`.
- `sms_connections`: row ID is the Appwrite user ID; unique E.164 phone index;
  owner read only. All writes go through the Function.
- `sms_challenges`: one server-only row per user; hashed token and expiry.
- `sms_receipts`: server-only immutable identity/reply plus `replyQueued`;
  row ID is the inbound Twilio MessageSid. Receipts intentionally survive note
  deletion, preventing a late replay from recreating a deleted note.

The public Function verifies all form parameters with Twilio's SDK against the
exact configured HTTPS webhook URL, account SID, and destination. It rejects
invalid signatures, duplicate form keys, oversized bodies, invalid E.164
senders, unsupported content types, and unexpected queries before using state.
`/status`, `/challenge`, and `/disconnect` validate an Appwrite user JWT with
`Account.get`; caller-supplied owner IDs are never accepted. Account status is
checked before capture or delivery. Row/file security remains enforced on web
access. The web authentication key has no new database/Messaging scopes.

The dynamic Function API key has `rows.read`, `rows.write`, `users.read`,
`users.write`, `targets.read`, `targets.write`, `messages.read`, and
`messages.write`. Appwrite requires `users.write` for its user-target creation
endpoint even when `targets.write` is present. The Function only uses this
permission to manage SMS targets and has no account-administration route.
It does not need a persistent privileged key.

## Idempotency and failure handling

Capture stages the note, receipt, and a binding touch in one TablesDB
transaction. A concurrent disconnect conflicts with capture. A deterministic
MessageSid protects concurrent deliveries; a changed payload under the same
SID is rejected. Commit errors are reconciled by reading the receipt, rather
than blindly creating another note.

The confirmation is a separate Appwrite Messaging write using the same SID as
its message ID. Lost responses and duplicate-create conflicts inspect that ID.
The receipt is marked queued only after confirmation persistence is known.
The Function's five-minute schedule retries up to five unqueued confirmations
per execution. It rechecks the current binding and account before sending, so
revoked connections cannot receive private pending replies. `replyQueued=true`
means handed to Appwrite or canceled after revocation, not handset delivery.
Appwrite owns the provider send. Appwrite `sent` is distinct from Twilio's
carrier delivery status. Failed provider deliveries are not blindly recreated:
inspect the Appwrite message and Twilio error before deciding on recovery.

The inbound URL uses Twilio's `#rc=3&rp=ct,rt,5xx` connection overrides for bounded
transport/server-error retries. The fragment is not part of the signature URL.
Backend authorization failures on the webhook return 503 so Twilio can retry;
invalid signatures remain 403, and invalid user sessions on settings endpoints
remain 401/403. The verifier exercises the exact deployed Function scopes,
including `users.write`, which Appwrite requires to create user targets.
No note content, phone number, code, raw request, or credential is intentionally
written to Function logs. Appwrite execution bodies and durable receipts may
contain personal data; restrict console/admin access accordingly.

SMS attachments are not fetched in Phase 1. A text with media saves its text and
explains that attachments must be added in Mio. Media-only messages receive a
clear response without an empty note. Reply STOP deletes the connection and
outstanding code. START unblocks Twilio but requires a fresh Mio connection.
Web disconnection stops Mio capture; it does not set Twilio's global opt-out
flag and returns unconnected SMS routing to Vapi.

## Deployment and verification

```sh
pnpm appwrite:generate
appwrite push table --all --force
pnpm sms:deploy
pnpm appwrite:deploy
pnpm sms:verify
```

`appwrite.config.json` records schema, Function settings/scopes/schedule, and
Site configuration. Each deployment uses an explicit staging allowlist;
secrets and provisioning files are excluded. Locked Function dependencies are
mapped from the workspace importer to an isolated deployment lockfile.

Function variables:

- `APPWRITE_SMS_PROVIDER_ID=6ac51435002ef67f3ecd`
- `MIO_PHONE_NUMBER=+12242866565`
- `TWILIO_ACCOUNT_SID` and secret `TWILIO_AUTH_TOKEN`, from the existing provider
- `TWILIO_WEBHOOK_URL=https://6ac51b26002d1520c40d.appwrite.network/inbound`
- `TWILIO_FALLBACK_SMS_URL=https://api.vapi.ai/twilio/sms`
- optional `APPWRITE_DATABASE_ID` (default `mio`)

Appwrite supplies the Function project/endpoint and per-execution API key.
Do not put Twilio credentials in Site/public variables. Deploy without
`--with-variables` so existing remote secrets are preserved.

`node scripts/configure-sms-number.mjs` previews the Twilio routing change;
`--apply` changes only SMS routing and checks the voice/status configuration
was preserved. It uses the ignored provisioning key to read the existing
provider, never prints credentials, and saves the original route under ignored
`.workflow/twilio-sms-route-before.json`. To roll back SMS routing, restore
that record's `smsUrl` and `smsMethod` in Twilio; do not change voice settings.

The live SMS verifier asserts the deployed scopes match configuration, uses a
short-lived API key with those exact scopes for workflow operations, creates
disposable Cloud accounts/targets/rows, and uses
**draft-only** messages. It tests rotation, permissions, concurrent duplicate
capture, lost commit/reply responses, replay after deletion, and revocation.
It never sends to synthetic phone numbers. Carrier delivery and a genuine
phone-originated Twilio callback require a separate acceptance check.

Appwrite can reject target creation because the phone identifier already
exists, even when the requested target ID is new. Mio reuses a matching SMS
target only if it belongs to the verified user and pins the same provider.
Another user's target is never moved or used. Test-only outbound targets must
be removed after delivery so they do not block a real account's connection.
Generating a new connection code invalidates the previous one immediately;
check the active code before sending an administrative recovery text.

For confirmation failures, inspect the receipt by inbound SID, the Appwrite
message with the same ID, and Twilio's message/error logs. If no Appwrite
message exists, the schedule or a genuine Twilio retry safely queues it. If
one exists, inspect it; do not delete its ID and resend automatically.
Keep receipt tombstones as long as replays are possible. Retention policy and
administrative data export/deletion are separate follow-up work.

## Progressive expansion

Only expand after the real phone-originated capture/confirmation/Realtime
acceptance check passes. Reminders should add explicit timezone, scheduled
item state, durable delivery IDs, and reply context; `done`/snooze must mutate
that item transactionally. Retrieval must query only the sender's authorized
notes. Actions/work sessions should reuse receipts as an idempotency boundary,
with clear persistent domain state. Daily digests should be opt-in and bounded.
No agent framework or speculative AI service is needed for the Inbox loop.
