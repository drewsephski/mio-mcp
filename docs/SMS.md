# Mio SMS assistant

Mio keeps the existing Twilio/Appwrite transport and adds a bounded conversational
agent behind it. Texts can create or edit notes, retrieve information, schedule
or cancel reminders, or simply receive a reply. Corrections change existing
entities rather than creating another note.

## Connect and use

Connect from `/settings/sms` using the existing one-time `connect …` text.
Codes have 128 bits of randomness, expire after 15 minutes, rotate on regeneration,
and are stored only as SHA-256 hashes. Consumption and phone binding commit
in one transaction. Each phone has one account, with an owned Appwrite SMS
target pinned to the existing Twilio provider.

Examples:

- “Remember I want Shiplog to make weekly recaps.” → “Actually make that daily.”
- “What did I say about Shiplog?” → “Delete that note.”
- “Remind me I have work at 4.” → “Actually work is at 4:30.”
- “And remind me 20 minutes before.” → “Cancel that reminder.”
- “What do I have going on today?”
- “My timezone is America/New_York.” (applies to the next turn)

Configured user timezone is initialized from `user.prefs.timezone`, or the
explicit `MIO_DEFAULT_TIMEZONE` fallback (America/Chicago). It is then stored
in `sms_conversations`; an explicit SMS timezone change overrides it. The
settings page shows it. Server timezone is never used. Tomorrow morning means
09:00 in that timezone; confirmations state the chosen time. Event reminders
default to 15 minutes before, configurable with `MIO_REMINDER_OFFSET_MINUTES`.
Task reminders with a requested time fire at that time. Explicit offsets and
notification times override defaults. DST gaps and overlaps require clarification.
Time-only corrections preserve the stored local calendar day. Changing that day
requires the tool to quote an explicit date reference from the current SMS.

Attachments are added/managed in Mio, not fetched from MMS. SMS deletion of a
note with attachments is rejected; archive it or delete it in the web app.
Completed notes use `completed=true`. Archiving, deleting, or completing a note
also cancels its pending linked reminders.
Web note update/delete events trigger reconciliation too; the minute worker
recovers missed events and cancels reminders whose linked note is unavailable.

## Architecture and authorization

`Twilio → validated webhook → durable SMS job → Luna + typed tools → transaction
(notes/reminder intent/turn/receipt) → Messaging reconciliation → SMS reply`.

Signature validation still includes every form field, against the configured
canonical HTTPS URL. Account SID, destination, E.164 sender, body size,
content type, duplicate parameters and unexpected query strings are checked
before persistence. HELP and Twilio STOP/START retain their transport behavior.
STOP disconnects the account and cancels pending reminders. START never rebinds
without a new connection code. Authenticated settings endpoints still validate
Appwrite JWTs with `Account.get`; no supplied owner ID is trusted.

The shared number retains Vapi voice routing and the existing unconnected-sender
SMS fallback, signed for its exact upstream URL. There is no duplicate fan-out.
Do not change voice or status callbacks when deploying this feature.

The function dynamic key keeps the existing row/user/target/message scopes.
No persistent privileged key or unrestricted database tool reaches Luna.
Each tool independently enforces the bound `ownerId`, exact entity IDs, input
validation and read-before-mutate. Named deletion references must quote the
current user's text and match one owned candidate; pronouns must identify one
recent note. Multiple matches produce clarification even if the model guesses.
Deletion is limited to one note per turn.

The AI SDK uses `generateText`, `tool`, Zod `inputSchema`, and `isStepCount(8)`.
At most 20 tool calls and eight writes execute per turn, serialized within one
TablesDB transaction. The model timeout is 45 seconds with no SDK retries.
Only OpenRouter is configured; default model is `openai/gpt-5.6-luna`.
Provider fallbacks are disabled and routing disallows providers collecting data.
Missing AI configuration fails through the same safe retry path; there is no
alternate provider or legacy capture fallback.
Invalid tool arguments, SDK tool errors, incomplete loops and unsafe final
responses roll back the whole turn. Known entity IDs cannot appear in replies.

## Durable tables

- `notes`: existing private user read/update/delete; optional `project` and
  `completed` fields, and body full-text search. Web edits preserve these fields.
- `reminders`: owner, optional note, `eventAt`, `remindAt`, IANA timezone,
  notification text, status, revision, desired `messageId`, `appliedMessageId`,
  target, reconciliation flag/error. Appwrite row metadata supplies timestamps.
  Owner-readable, server-write-only.
- `sms_turns`: owner-readable, server-write-only text/reply and bounded entity
  references. The prompt loads only six turns. Retrieval tools return bounded
  results; full notes are fetched only when needed.
- `sms_conversations`: owner-readable, server-write-only timezone, default offset,
  and a fenced owner lease. It serializes turns and reminder reconciliation.
- `sms_jobs`: server-only input queue, payload fingerprint, retry count and next
  attempt. SID is the deterministic row ID. Successful/terminal jobs erase the
  duplicate body copy; durable turn history remains separate.
- `sms_receipts`: infrastructure tombstone, never prompt history. The SID and
  payload fingerprint prevent replay, including after note deletion. Replies
  remain durable and have deterministic Messaging IDs. An optional server-only
  draft delivery mode isolates Cloud verifier fixtures from production workers.
- Existing `sms_connections`/`sms_challenges` keep their isolation and unique
  phone/token indexes.

Keep receipt/job tombstones while Twilio replays remain possible. Automated
retention/export is not introduced in this change.

## Retry and scheduling guarantees

Inbound acceptance commits the job and binding touch before returning empty
TwiML. Appwrite's `tablesdb.mio.tables.sms_jobs.rows.*.create` event starts a
worker. One shared minute schedule drains missed events/retries, reconciles
reminders and retries unqueued replies; there are no per-reminder cron jobs.
Jobs run in arrival order per owner. An expired lease recovers after 150 seconds.
Only one model turn runs per function execution; function timeout is 120 seconds.

Tool mutations, conversation references, the receipt and completed job commit
atomically. A binding touch conflicts with concurrent disconnect. Failed or
incomplete inference rolls back every staged action; retries cannot duplicate
them. Three failed attempts produce an honest failure reply with no changes.
A lost commit response is inspected through the receipt before any replay.
A lost Messaging response is inspected by exact ID/content/target/time.

TablesDB is the source of truth for reminder intent. New reminders create a
native Appwrite draft, then activate it with `scheduledAt=remindAt`. Reschedules
commit a new desired revision, cancel/delete the old scheduled message, create
and activate its deterministic replacement, and store the applied message ID.
The reconciliation flag persists until this saga finishes. A crash at any step
is inspected and resumed; successful message IDs are never deleted/recreated
as retries. Confirmations wait until scheduling is known. Delivery failures
produce a safe correction instead of claiming success.

Messaging and TablesDB cannot share a transaction. Only desired state is
atomic; provider reconciliation is durable and retryable. Messages already
processing/sent cannot be recalled. Changes within one minute of notification
are rejected; if an old message begins processing during a change, no second
reminder is created and the reply explains uncertainty. Disconnect cancels
scheduled messages when possible; a carrier-bound text cannot be unsent.
Missed notification times fail visibly instead of sending stale reminders.
No automated retries of a provider's terminal/ambiguous delivered message
create a new delivery ID. `sent` reflects Appwrite acceptance, not handset proof.
Disconnect also invalidates the owner's lease. Before activating a native
schedule, reconciliation rechecks the lease, connection, account, desired
revision and linked note. Fenced transactions prevent a stale worker from
resurrecting canceled state. Reply authorization is rechecked after scheduling.

Logs contain fixed operational event names and sanitized status/type only.
Never log phone numbers, bodies, note content, prompts, API keys or credentials.

## Deploy and verify

Use pnpm and the existing Appwrite project configuration:

```sh
pnpm appwrite:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm sms:build
pnpm build
appwrite push table --all --force
pnpm sms:configure-ai
pnpm sms:deploy
pnpm sms:verify
pnpm appwrite:verify
```

`pnpm sms:configure-ai` reads ignored `.env.local`/`.env.provisioning` and securely
upserts the OpenRouter key as a **secret Function variable**, plus the model,
timezone and default offset. It preserves all other variables. The key is not
included in `appwrite.config.json`, the deployment archive, the Site, or logs.
The provisioning key needs function-variable read/write access. Deploy without
`--with-variables`; replacing the full variable set could erase Twilio secrets.
The source preparation script uses an allowlist and an isolated frozen lockfile.

Regular tests use the AI SDK mock model and never pay for inference. They cover
multi-turn actions, durable scheduling, ambiguity, owner isolation, concurrent
replays, failed/partial model turns, storage failures, lost commit/reply writes,
revocation, already-processing messages, and real IANA/DST conversion.
`pnpm sms:evaluate` is opt-in paid Luna inference over a synthetic corpus; all
its persistence/Messaging tools are in memory. It cannot mutate Cloud data.

The Cloud SMS verifier uses an ephemeral key with exactly the function's scopes,
disposable accounts/targets, verification-only jobs and **draft-only** replies.
Production workers ignore those jobs and draft receipt delivery. It retains
connection rotation, foreign target protection, permissions, duplicate
acceptance, lost response reconciliation, replay tombstones and revocation.
It also exercises cancellation through real fenced reminder transactions.

`pnpm sms:verify-deployed` checks deployed readiness without sending SMS.
`pnpm sms:verify-deployed --send` explicitly exercises signed callback simulation
and real outgoing messages on the currently connected account. Run with no
concurrent handset turns, which would legitimately change conversational state.
Add `--proactive-only` to isolate a near-term native scheduling/delivery check.

For an end-to-end acceptance check, text from the connected handset, inspect
only the corresponding receipt/entity/message IDs, and distinguish Appwrite
message status, Twilio delivery status, and actual handset receipt. Administrative
signed callback simulation proves deployed processing, not handset-originated
Twilio acceptance. Scheduled SMS must also be observed at the carrier/handset.

For failures inspect job status/attempts, the immutable receipt, reminder
revision/applied ID and safe error code. Refresh before retrying uncertain
writes. Never delete a receipt/message ID to force a resend.
