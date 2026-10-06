# Mio web beta rollout

The web companion is Today, Notes, Reminders, Activity and Settings. Phone onboarding remains the existing authenticated one-time-secret binding, now with explicit optional consent and a prepared Messages link. The model never selects the account owner. Web reminder mutations share the same fenced owner lease, optimistic revision check and durable native Messaging reconciliation as SMS.

## Activation order

1. Choose the dedicated shared Mio Twilio number and create its Messaging Service. Configure its inbound webhook, Advanced Opt-Out STOP/HELP behavior and its Appwrite SMS provider/target routing. Keep the development Vapi number separate. This change does not purchase a number or change provider routing.
2. Configure the public support email and legal operator name. Review the policy and SMS text against the actual operator, retention practices and provider campaign. Publish the public landing, Privacy Policy, Terms and SMS terms, plus publicly inspectable consent-flow evidence for the campaign. The beta defaults to Drew Sepeczi as operator and drewsepeczi@gmail.com for support, supplied during implementation. Both remain configurable.
3. Register the brand/campaign and attach the dedicated number. Confirm approved A2P status before inviting US recipients. Twilio requires US application-originated 10DLC registration and, since June 30, 2026, public privacy/terms URLs. Sources: [registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart), [policy URL requirement](https://www.twilio.com/en-us/changelog/a2p-10dlc-campaign-registration-will-require-privacy-policy-and-).
4. Deploy added conversation/consent columns and the three usage tables before activating this Function. Regenerate types from the deployed schema. Set the same exact comma-separated `MIO_INVITE_EMAILS` on Site and Function, set `MIO_SUPPORT_EMAIL` on both, and set `MIO_OPERATOR_NAME` on the Site. The list defaults closed. Existing accounts can sign in; only accounts with verified invited email addresses can use the assistant and companion APIs. New and existing unverified users must complete Appwrite email verification before phone setup; notes remain accessible. The web signup handler enforces invitations. Appwrite project-level public account creation needs separate provider review: the public SDK may still create an account directly, but it cannot bypass Function assistant admission.
5. Review count/cost ceilings for the cohort and model; configure provider budget alerts/spending limits as a separate backstop. `pnpm sms:configure-beta` prints a dry-run summary; append `--apply` to update Function variables without replacing unrelated secrets. It does not configure Site variables, Twilio or A2P.
6. Deploy Function, then Site, preserving existing credentials. Test two invited accounts with separate phones: pairing, note isolation, timezone, correction, reminder edit/cancel, STOP, HELP and scheduled delivery. Include a noninvited account and a temporarily exhausted budget. Local tests are not Cloud permission or real-handset proof.

Schema and provider mutations, deployment, inviting people, and outbound messages were not performed as part of this implementation.

Local verification and the boundary between browser fixtures and live provider evidence are recorded in [QA.md](QA.md#web-beta-implementation--2026-10-06).

## Product semantics

- One shared configured Mio number; one verified phone per account. Existing bindings are retained. Old unconsumed challenges without current consent cannot connect.
- Quiet hours are optional and reject new/edited notification times inside the chosen user-timezone interval. They do not silently move notifications, suppress conversational replies or rewrite existing schedules.
- Disabling SMS disconnects the binding, revokes leases, cancels pending intent and attempts every pending native recall. Failed recalls remain visible and retryable. Already-processing/carrier-bound texts cannot be recalled.
- Proactive messages and digests are disabled; unsupported opt-ins are rejected rather than stored as working features.
- Activity is a factual transcript with entity references. The old history lacks mutation snapshots, so the app does not invent before/after actions. Direct web edits are visible in current entities but do not create fabricated SMS turns.
- UTC usage counts describe admitted/reserved operations. Token totals are observed when supplied. The budget is a configurable reservation estimate, not a Twilio/OpenRouter invoice; native schedules reserve when created and may fire on later days. Inbound Twilio charges already happen before webhook admission. See [usage semantics](USAGE.md).

## First cohort

Start with 5–10 invited people. Review delivery errors, misunderstood corrections, useful memories, web visits and each user's separate texting days. The initial behavioral metric is users who text Mio on three or more separate days in a week. No analytics claims or tracking integration were added; conversation timestamps supply inspectable source data for a later owner-scoped report. Expand only after real-phone acceptance and reviewed budget capacity.
