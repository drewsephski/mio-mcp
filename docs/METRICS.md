# Private beta metric definitions

All windows use UTC calendar days. The rolling seven-day window includes today
and the six preceding dates. Only active, verified invited accounts contribute
to aggregates. An owner-scoped infrastructure support response contains no text.

| Signal | Reproducible definition |
| --- | --- |
| Admitted users | Active Appwrite users with verified email in current invite list |
| Connected phones | Current sms_connections rows for admitted owners |
| Connected activation | Current connected owners with a successful committed turn at/after connection creation, divided by connected owners |
| First successful turn | Earliest sms_turns timestamp without failed outcome; legacy turns are known committed successes |
| First successful reminder | Earliest created-at timestamp of a reminder currently marked sent by Messaging reconciliation; sent is not handset delivery |
| Active SMS days | Distinct UTC created dates in sms_turns for an admitted owner, including terminal failures |
| 3-day weekly retention signal | Admitted users with turns on at least 3 distinct UTC days in current seven-day window; this is a return-frequency signal, not cohort-adjusted D7 retention |
| SMS turns | Durable committed turns, including terminal failure turns |
| AI attempts / outbound SMS | usage_daily admitted/reserved attempts/messages, not provider invoices |
| Clarification rate | Window turns with clarification outcome divided by turns with known outcomes; legacy unknowns excluded |
| Failed assistant-turn rate | Failed jobs created in the window divided by done + failed jobs created in the window; waiting/retrying/revoked excluded |
| Reminder scheduling failure rate | Currently failed reminders created in the window divided by all reminders created in the window; cancellations included in denominator; this includes delivery/recall failures and is not a classified provider error rate |
| Rejected reminder turns | Window turns with reminder_rejected after a tool rejects creation/edit; uncommitted/failed actions never counted as success |
| Reminder edit / cancel usage | Window committed SMS turns with updated_reminder/canceled_reminder; linked cancellations also count; one turn counts once per outcome |
| Web reminder edits observed | Window-created reminders with revision > 1 across any channel, an explicitly labeled proxy rather than invented web action counts |
| Companion visitors | Distinct admitted owners with daily companion_visits records in window, web or mobile; separate daily surface recorded |
| Near daily limits | Daily AI or outbound reservation count >= 80% of its configured ceiling |
| Global breaker | Whether another ceiling-sized AI/SMS reservation would exceed UTC global budget |

Outcome values originate in successful tool executions, staged in the same
transaction as the actions and turn. If commit is lost, the exact receipt/turn
is inspected rather than replayed. Failed transaction outcomes are discarded.
Terminal failures commit only failed metadata and an honest reply. A performed
askClarification tool requests a clarification; no model reasoning is stored.
No-tool prose is no_action; successful reads are answered. Historical turns are
not retrospectively labeled. There is no broad analytics SDK, message copy,
IP collection, browser fingerprint, advertising identifier or page URL history.
