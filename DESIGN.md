---
name: Mio
description: A private personal assistant over text, with a web companion for notes and reminders.
colors:
  background: "#ffffff"
  foreground: "#172033"
  muted: "#627087"
  blue: "#2458d3"
  pale: "#f2f6ff"
  line: "#e5eaf1"
  surface: "#f8faff"
  blue-hover: "#1945b3"
  danger: "#b42335"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(44px, 4.5vw, 62px)"
    fontWeight: 650
    lineHeight: 1.13
    letterSpacing: "-.055em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  utility:
    fontFamily: "Geist Mono, monospace"
    fontSize: "11px"
rounded:
  control: "9px"
  panel: "16px"
spacing:
  page-gutter: "clamp(20px, 3.5vw, 48px)"
  control-gap: "8px"
  form-gap: "22px"
  panel-inset: "24px"
  section-gap: "36px"
---

# Mio design system

Mio is a private assistant for people who want to capture thoughts and manage reminders through the Messages app they already use. The landing page explains that workflow and leads invited users to create an account. The companion makes saved information and exact reminder schedules easy to inspect.

The visual direction keeps Mio’s white canvas, clear blue, three-bar wordmark, and compact navigation. The signature is the transition from a familiar text conversation into a structured note or reminder. That is the one expressive device; surrounding layouts remain quiet.

## Palette and type

The six core colors are White `#ffffff`, Ink `#172033`, Slate `#627087`, Mio blue `#2458d3`, Pale blue `#f2f6ff`, and Divider `#e5eaf1`. Cool white `#f8faff` supports navigation and secondary surfaces. Dark blue is reserved for primary-action hover. Red and green appear only in semantic feedback.

Manrope gives headings a rounded, conversational voice. Geist remains the body and interface face; Geist Mono identifies onboarding progress and private connection codes. All three are self-hosted through `next/font`. Note list titles and the miniature result-card title use Geist to keep reading and navigation consistent.

The landing headline uses a 44–62px responsive scale, 650 weight, 1.13 line height, and tight tracking. Product headings use 25–32px, section headings 19–25px, and note editor titles 28–34px. Reading text uses 14–16px, with longer legal copy at 15px/1.9 and editor text at 15px/1.95. Secondary product text is generally 12–13px. The illustrative demo uses smaller caption and metadata sizes; those are not product reading sizes.

## Page structure

```
Landing:     thesis and invitation | text conversation → saved result
             three concrete uses  | companion overview | beta invitation
Companion:   navigation | page title + actions
                       | content grouped by task
Notes:       navigation | note list | spacious editor + attachments
Settings:    navigation | section explanation | controls
Policies:    section index | readable policy column
```

The public page frame caps at 1280px with responsive 20–48px gutters. The hero has two equal columns and stacks below 800px. Its interactive examples demonstrate saving, scheduling, and retrieval, with explicit sample labeling. Capability cards have aligned examples at the bottom; the companion overview describes the four relevant destinations.

Product navigation uses a 216px sidebar, a 72px tablet rail, and five labeled destinations on phones. Accessible names remain present when visible labels are hidden. Today puts upcoming reminders beside recent notes on wide screens and stacks them below 1100px. Settings pairs a short section explanation with its controls; the columns stack below 800px.

The notes list uses a 300px desktop pane, narrowing to 265px and 230px before becoming a horizontal strip on phones. The editor keeps a generous reading measure and explicit save status. Long attachment names wrap, and their deletion confirmation occupies its own row. Shared product navigation also serves Notes and phone connection management.

Account and recovery flows share a 460px card, common header, heading scale, spacing, and footer. Onboarding keeps its genuine two-step sequence. The SMS consent disclosure and connection fallback retain their existing behavior and wording.

Policy pages pair a sticky section index with a 700px reading column. The index stacks above the document on smaller screens. Every index link resolves to a real policy section. Policy wording and effective dates are preserved.

Operator pages use the same typography and spacing, bordered metric cells, and a narrower reading column for metric definitions. Their data and access rules remain independent of the visual treatment.

## Controls and states

Controls use 9px corners; panels use 16px. Standard buttons have a 44px minimum height, fields at least 46px, and icon controls 40px. Hover feedback is tonal, with no entrance animation or ornamental shadow. Visible blue focus outlines apply to buttons, links, fields, and disclosure summaries. Reduced motion disables transitions and smooth scrolling. Phone fields use 16px text to avoid focus zoom.

Reminder cards put the exact notification time above the message. Event time, notification offset, and timezone are separate labeled details. Editing, cancellation, pending synchronization, delivery errors, and ambiguous-result recovery retain their existing controls and safeguards.

Activity presents the recorded texts as restrained conversation blocks, with real note and schedule references below. Empty states name the missing content and give a next step. Error pages share the account layout; loading screens center the brand and an announced status.

## Copy and assets

Prefer concrete actions: Create your account, Save note, Edit reminder, Save changes, Connect your phone. Headers and form modes stay in sync when switching between sign-in and sign-up. Do not invent saved data, confirmed deliveries, or capabilities in production copy.

Mio’s wordmark is semantic text with a CSS mark. Icons are inline Lucide SVGs. The landing demo is semantic, interactive UI; nothing is sent or saved. No raster assets were introduced. The inherited favicon and its existing provenance sidecar remain unchanged.

Local verification and the distinction between public-page checks and populated fixture checks are recorded in [docs/DESIGN-QA.md](docs/DESIGN-QA.md).
