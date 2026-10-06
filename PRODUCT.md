# Mio

<!-- impeccable:product-schema 1 -->

## Platform
web

## Product Purpose
Mio is a private personal assistant you can text. The shared Mio number is the primary interface; the web companion lets users inspect and manage its memory, requested reminders, conversation history, and preferences. Think something → text Mio → Mio acts → the companion becomes the organized source of truth.

## Capabilities and Constraints
Email/password accounts, authenticated dashboard, title search, note editing and archiving, private attachments, email verification, and password recovery. Next.js App Router, TypeScript, pnpm, and Appwrite Cloud in NYC. Ownership is enforced by user sessions and Appwrite row/file permissions. SMS uses the existing Twilio provider, an Appwrite Function, TablesDB receipts and bindings, user targets, and owner-authorized Realtime. Production uses one dedicated Mio number shared by all users. The old Vapi SMS fallback runs only in explicit legacy-shared development mode. Conversational retrieval, actions, and requested reminders exist. Today, Notes, Reminders, Activity, Settings, and consent-led phone onboarding form the web beta. Verified email ownership, server-enforced invitations and usage limits gate assistant access. Proactive messages, digests, additional conversational channels, and native mobile apps remain out of scope. No public sharing or team collaboration is in scope.

## Brand Commitments
Name: Mio. User-selected crisp white surfaces, compact layouts, and blue accents. User selected building directly in code.

## Evidence on Hand
The landing page may show clearly labeled example notes. No customer counts, testimonials, pricing, performance benchmarks, or encryption promises were supplied.

## Open Decisions
The permanent dedicated number, Messaging Service and approved A2P campaign remain provider launch gates. Beta support is drewsepeczi@gmail.com; the individual operator label is Drew Sepeczi, configurable for a future legal entity. Beta admission is an exact email allowlist shared by the Site and Function. Quiet hours apply to new or edited reminder notification times, preserve existing schedules, and use the user preference timezone. Configured cost reservations bound new work; actual provider billing remains separate.
