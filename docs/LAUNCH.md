# External launch readiness

Mio uses one permanent shared SMS number. The operator selected the existing
number for Mio SMS on 2026-10-06. Its voice routing is preserved. Function
production mode is dedicated: no unconnected SMS is forwarded to Vapi.

Keep `.workflow/twilio-launch.json` private and use `pnpm launch:check` before and
after a release. A checked box is an operator attestation, not an API observation.
The command separately reports both. It verifies number identity/capability,
provider-number agreement, Messaging Service membership, inbound URL and public
legal route availability. It cannot certify legal policy adequacy, handset
receipt, campaign approval, console-only Advanced Opt-Out or spending alerts.

```json
{
  "confirmedBy": "Operator name",
  "confirmedAt": "ISO timestamp",
  "numberSid": "PN...",
  "dedicatedSmsOnExistingNumber": true,
  "messagingServiceSid": "MG...",
  "checks": {
    "dedicatedNumber": true,
    "messagingService": true,
    "inboundWebhook": true,
    "advancedOptOut": true,
    "a2pApprovedWhereRequired": true,
    "privacyLive": true,
    "termsLive": true,
    "smsTermsLive": true,
    "supportContact": true,
    "spendingAlerts": true
  }
}
```

Select the dedicated SMS number, attach it to the Messaging Service, configure
POST inbound webhook to the exact canonical `/inbound` URL used for signature
validation, and configure Advanced Opt-Out STOP/START/HELP. With service inbound
routing, either use the number webhook or set the service inbound URL to Mio.
Appwrite SMS provider must use that same sender. Confirm A2P brand/campaign
approval where required, policy URLs, support contact and spending alerts in
Twilio/OpenRouter consoles. Test STOP and reconnect from both handsets.

Never purchase/swap a number or change voice routing from a release command.
The old configure-sms-number helper is a historical shared-number operation and
is not a production path. Provider configuration is a separate explicit task.
