# Mio private beta

The authoritative release path is [OPERATIONS.md](OPERATIONS.md). External
provider readiness is [LAUNCH.md](LAUNCH.md), and real first-cohort acceptance is
[ACCEPTANCE.md](ACCEPTANCE.md). Historical QA is recorded separately in QA.md.

Mio keeps one private owner-scoped account, conversation and phone binding.
The web hierarchy remains Today, Notes, Reminders, Activity, Settings. Setup is
invited account → email verification → introduction → optional explicit SMS
consent → Open Messages → pairing text → automatic detection → first useful text.

Quiet hours reject new/edited reminders in the user's interval rather than
silently moving existing schedules. Disabling SMS revokes bindings/leases and
cancels pending intent, with durable retries for native recalls. Carrier-bound
texts cannot be recalled. Digests/proactive opt-ins remain disabled. Activity
records committed non-sensitive action outcomes, never model reasoning.

Counts describe reservations/observations, not provider invoices. Inspect the
operator health route and the three-distinct-SMS-days weekly return signal.
Start with 5–10 invited people after two-handset acceptance and budget review.
CI, schema compatibility, carrier delivery and actual handset receipt remain
separate evidence.
