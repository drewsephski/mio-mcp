# Mio iOS companion

`apps/mobile` is an isolated Expo 57 / React Native / TypeScript client. The web
Site remains at the repository root and deploys independently of native builds.
The companion signs into the existing Appwrite account, reads/edits private
notes, reads/edits/cancels reminders through the existing revision-fenced
Function API, saves time/quiet-hour preferences, and opens Messages to the same
Mio number returned by the server. Phone pairing and account creation/recovery
open the existing web flow, preserving its consent and invitation checks.

## Run and verify

Use Node 22.13+ and the root pnpm lockfile. `pnpm install --frozen-lockfile`, then
copy `apps/mobile/.env.example` to `apps/mobile/.env.local` if overriding public
project settings. **Never put server keys, operations tokens or session secrets
in EXPO_PUBLIC variables.** The project registers `com.mio.companion` as its Apple
platform; changing this requires changing app.json, the adapter and Appwrite.

- `pnpm mobile:dev`: Metro for a development client.
- `pnpm mobile:ios`: generate the ignored native project, install pods and run
  on an available simulator. Xcode 26.4+, CocoaPods and iOS 16.4+ are required.
- `pnpm mobile:typecheck` and `pnpm mobile:export`: deterministic CI checks.
- `pnpm test`: shared contract/client tests, including foreign note rejection,
  server admission, revision forwarding and no automatic mutation replay.

SDK cookies use the native HTTP session store; passwords are cleared after
successful sign-in and never persisted by Mio. Every boot checks the account
and server admission before rendering private content. Verify persistence,
expiry, logout and account switching on an actual iPhone before distribution.
No private notes are written to an offline cache. Edits are online, and uncertain
writes require refreshing before another attempt. Notes use owner permissions;
reminder mutations retain the backend lease/revision/quiet-hour safeguards.

## SDK risk and Apple identity

[Appwrite's React Native quickstart](https://appwrite.io/docs/quick-starts/react-native)
still calls its SDK beta. Version 1.1.0 is confined to `src/client.ts`; screens
consume the small validated domain client in `packages/domain`. Its legacy
expo-file-system dependency is pinned through a scoped pnpm override to Expo's
supported 57 implementation. No uploads depend on that SDK yet. Both native
export and simulator compilation must pass before changing the override.

[Appwrite native sign-in](https://appwrite.io/docs/products/auth/native-sign-in)
supports Apple ID-token sessions with a SHA-256 nonce sent to Apple and the raw
nonce sent to Appwrite. A current Appwrite session attaches Apple to that exact
account; verified matching email can also converge identity, while Apple's
private relay email alone must not be treated as proof of the existing account.

The initial beta uses email/password sign-in. Settings includes native Apple
linking only when `EXPO_PUBLIC_MIO_APPLE_LINK_ENABLED=true`. It checks server
admission before linking and verifies the account ID afterwards. Before enabling,
configure the Apple capability/credentials and Appwrite's separate native Apple
provider with the allowed bundle ID. Browser OAuth configuration alone does not
enable native ID-token sessions. Keep native public account creation closed.
The eventual public iOS app should use native Sign in with Apple after identity
linking and admission have received real-device acceptance. Web email/password
remains available.

## Shared domain and future Share to Mio

`packages/domain` contains existing note validation, companion response models,
types/time formatting and the native client port. The web re-exports its existing
import paths. There are no shared DOM components, second database, offline sync
engine or duplicate reminder mutation rules.

A future Share Sheet belongs behind this same account/client boundary. Text and
URLs should become normal private notes; images/PDFs should use the existing
private attachment bucket and metadata, with current validation and owner
permissions. The extension needs an explicitly designed shared credential
container and uncertain-upload recovery before implementation. Do not put an
administrative key in it or create another ingestion database. No extension,
background capture queue or object-processing infrastructure is shipped here.

## Device acceptance

On two real invited accounts: sign in, restart, verify Today, read/edit a note,
edit/cancel a reminder, change timezone/quiet hours, tap Text Mio, and sign out.
Switch accounts and confirm no previous user's data remains. Test offline/error
states and refresh after an uncertain write. Apple linking requires separate
provider/device evidence. Simulator rendering or CI export is not handset SMS,
session-persistence or Apple acceptance. Cohort acceptance remains in ACCEPTANCE.md.
