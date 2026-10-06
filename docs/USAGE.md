# Mio beta usage controls

The SMS worker reserves capacity in Appwrite **before** model calls and new outgoing Messaging operations. Reservations, daily counters and a shared global budget bucket commit together in one transaction. Concurrent workers cannot each spend the same remaining global capacity. Storage outages and transaction conflicts fail closed; they do not authorize a provider call.

`usage_daily` contains owner-readable counters. `usage_events` stores private deterministic operation identities. `usage_global` contains private minute/hour/global-day buckets. The client cannot modify these tables. Deploy the schema before activating a function that requires usage controls.

## Configuration

All values must be nonnegative whole numbers in plain decimal notation, within JavaScript's safe integer range. Cost ceilings must be positive. Invalid values stop worker initialization rather than disabling a limit. Setting a count or global budget to zero denies that operation.

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MIO_MAX_INBOUND_PER_MINUTE` | 6 | Accepted unique inbound messages per owner per UTC minute |
| `MIO_MAX_AI_PER_HOUR` | 30 | Model attempts per owner per UTC hour |
| `MIO_MAX_AI_PER_DAY` | 100 | Model attempts per owner per UTC day |
| `MIO_MAX_OUTBOUND_PER_DAY` | 200 | New outgoing message reservations per owner per UTC day |
| `MIO_MAX_ACTIVE_REMINDERS` | 50 | Active reminder capacity; enforced by reminder tools |
| `MIO_MAX_SCHEDULED_OUTBOUND` | 75 | Scheduled outgoing reminder capacity; enforced by reminder tools |
| `MIO_AI_TURN_CEILING_MICROS` | 250000 | $0.25 reserved per model attempt |
| `MIO_SMS_MESSAGE_CEILING_MICROS` | 500000 | $0.50 reserved per inbound or outgoing message |
| `MIO_GLOBAL_AI_DAILY_MICROS` | 20000000 | $20 daily global model reservation budget |
| `MIO_GLOBAL_SMS_DAILY_MICROS` | 10000000 | $10 daily global SMS reservation budget |

A microdollar is one millionth of a US dollar. These amounts are configurable cost estimates intended to upper-bound a supported operation, **not actual provider charges or invoices**. Review the ceilings for the deployed model, its maximum tool steps, context/input size, SMS Unicode and multipart segments, destination country, carrier fees and provider pricing. If an operation costs more than its configured estimate, actual charges can exceed the reservation budget. Provider spending limits remain an independent backstop.

The deliberately restrictive defaults prioritize limiting beta exposure. The SMS default permits at most 20 newly reserved messages across all owners per UTC day, including both inbound and outbound. A typical inbound message plus its reply reserves $1. Configure an appropriate reviewed budget before inviting a larger cohort.

## Exact semantics

- Minute, hour and day limits use fixed UTC calendar windows, not rolling windows or the user's timezone. Activity on both sides of a window boundary may exceed a rolling-window rate.
- Inbound delivery uses the Twilio SID as operation identity. Duplicate delivery does not consume another reservation. STOP/disconnection bypass conversational admission limits. The dedicated Messaging Service owns Advanced Opt-Out HELP acknowledgements, so those callbacks return empty TwiML. Plain HELP and new connection texts still use the bounded application path.
- Every model attempt has a separate identity such as `SID:attempt:2`. Failed attempts still count toward hourly/daily limits and retain their full cost reservation. A provider timeout with unknown token usage is never interpreted as zero cost.
- An ambiguous reservation commit is inspected by deterministic identity. An existing reservation returns `created: false`. A model call must only run when its reservation returns `created: true`; never replay an ambiguous attempt. Existing idempotent Messaging identities may be reconciled after `created: false`.
- Observed provider input/output token totals are recorded once per attempt, even if the generated reply is subsequently rejected. Missing provider metrics remain unobserved. Token totals do not refund the reserved ceiling.
- Outgoing message identity is the deterministic Appwrite Messaging message ID. A retry of that same operation is not charged twice. New replacement schedules use new identities and consume capacity; cancellations do not refund previously reserved capacity.
- Scheduled native messages reserve budget on the UTC date **they are scheduled**, not the date they eventually fire. Previously reserved native schedules can still fire when today's new-send budget is exhausted. This is an incurred/reserved-operation budget, not a prediction of daily delivered-message billing.
- The global SMS budget caps every new send without a critical-reminder bypass. It also conservatively accounts for accepted inbound messages, but it cannot prevent Twilio from receiving additional traffic.

**Inbound SMS billing is unavoidable at webhook time:** Twilio has already received the message before Mio can reject or rate-limit it. These controls limit subsequent processing and outgoing/model costs. They do not prevent a third party from creating inbound carrier/provider charges. Configure Twilio/provider abuse protections and spending alerts separately.

`usage.daily(ownerId)` returns only that owner's current UTC-day counters, user limits and global admission-blocked booleans. It does not expose another owner's counts, shared global totals, operation identities or Appwrite metadata. Counts describe durable reservations; displayed token totals describe observed metrics, not guaranteed complete provider billing.
