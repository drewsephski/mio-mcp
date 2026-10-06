# First-cohort acceptance

Run after `pnpm release:verify` and `pnpm launch:check`. Do not claim cohort
acceptance from local tests or provider sent status. At least two separately
verified invited accounts and two physically different phones are required.

## Automated isolated backend acceptance (no AI/SMS)

`pnpm appwrite:verify` creates two disposable server-managed verified/labeled
accounts, tests note/file permissions, then cleans up exact fixture IDs. It never
changes real account invitations or limits and sends no email/SMS. `pnpm beta:isolation`
adds raw permissions tests for reminders, turns, bindings, preferences, usage
and server-controlled jobs plus a public Account signup bypass attempt. Both
require `.env.local` and `.env.provisioning`; they are explicitly live checks.

## Actual two-user/phone path

Use an ignored `.workflow/cohort-acceptance.json` based on
`docs/cohort-acceptance.example.json`. The identities must resolve to different
active invited accounts and current phone bindings. `pnpm beta:cohort` checks
readiness and isolation prerequisites and exits nonzero until all human handset
observations are recorded. It does not send a paid request or certify a checked
box automatically. Record UTC time, observer and result per check; no transcript
or phone numbers are needed in the evidence file.

1. A/B create invited accounts, verify email, read introduction, explicitly agree
   to SMS terms, Open Messages, send pairing text, observe automatic detection.
   A third uninvited direct Auth caller must be denied signup; if a provider
   policy is relaxed, its account must remain inert and operator/assistant denied.
2. A and B each save distinct unique synthetic thoughts. Each must fail to get,
   edit, archive, delete, reference or infer the other's notes, reminders, turns,
   binding, preferences and usage, by both direct SDK and natural-language texts.
   Request the other's ID and note keywords; Mio must not reveal existence/text.
3. Each phone sends, in order: `Remember I need to call Sarah tomorrow`,
   `Actually make that 3 PM`, `Remind me 20 minutes before`,
   `What do I have tomorrow?`, `Cancel that`. Confirm the same note/reminder is
   corrected, day is preserved, exact notification time is truthful, and native
   Messaging schedules are replaced/canceled. Saving a dated thought alone is
   not a reminder request; the third text explicitly requests notification.
4. Create two plausible references and send `Cancel that`. It must clarify before
   changing either. Also test named unique targets and unrelated chit-chat.
5. Schedule a near-term reminder from each phone and observe physical handset
   receipt. Provider delivered status is separate supporting evidence. Edit
   ahead of the send fence; verify old message recall. Try edit/cancel within
   60 seconds of send; expect rejection and honest UI. Observe cancellation.
6. Send STOP, ensure disconnect/pending recalls, no subsequent assistant reply.
   START must not silently reconnect; pair with fresh consent/code from web.
   Test HELP in the configured Messaging Service.
7. Set different timezones on A/B; confirm tomorrow/day boundaries and reminder
   offsets. Set overnight quiet hours; times inside are rejected without silent
   rescheduling. Observe DST-gap/overlap handling with synthetic dates.
8. Exercise inbound per-minute, hourly/daily AI, outbound, active-reminder and
   global budget breakers using an isolated Appwrite test project and synthetic
   identities with low bounded limits. Never exhaust production money or disable
   a guard to test it. Deterministic usage tests already exercise exact boundaries;
   production fixture budgets must remain enabled. Restore no production globals.
9. Reload Today, edit a note/reminder in web, verify owner state, and inspect
   aggregate operator metrics. A normal account must get denied `/operator` and
   `/api/operator/...`; first activation and three distinct days require real
   observations over time. Never invent retention from an afternoon test.

## Acceptance result

All required checks must have `result: "pass"`, observer and observedAt. Failure,
missing observation or incomplete release/provider verification remains red.
Keep source snapshots, CI, live schema, provider delivery, inbox and physical
handset evidence distinct. Start with 5–10 invited users only after reviewing
these gates and reserved budget capacity.
