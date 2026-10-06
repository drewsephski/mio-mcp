---
name: Mio
description: A compact private workspace for notes and their files.
colors:
  background: "#ffffff"
  foreground: "#172033"
  muted: "#627087"
  line: "#e5eaf1"
  blue: "#2458d3"
  blue-hover: "#1945b3"
  pale: "#f2f6ff"
  surface: "#f8faff"
  danger: "#b42335"
  danger-surface: "#fff1f2"
  field-border: "#cfd7e4"
  field-placeholder: "#69778c"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "clamp(42px, 4.8vw, 64px)"
    fontWeight: 580
    lineHeight: 1.08
    letterSpacing: "-.04em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
    fontWeight: 550
  button:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.2
rounded:
  icon-control: "6px"
  field: "7px"
  control: "8px"
  container: "12px"
spacing:
  gap-compact: "8px"
  gap-control: "10px"
  inset-small: "12px"
  inset-control: "16px"
  inset-panel: "18px"
  inset-section: "24px"
  inset-wide: "28px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.background}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.icon-control}"
    width: "36px"
    height: "36px"
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  note-selected:
    backgroundColor: "{colors.pale}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "16px 13px"
  auth-card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.container}"
    padding: "36px"
---

# Design System: Mio

## Overview

**Creative North Star: "A little room for your thoughts"**

Mio uses the shipped product's own phrase as its north star: a quiet, compact workspace with room for the note itself. White and cool off-white surfaces, ink text, blue actions, and Geist establish the user-pinned visual direction. The same restrained controls run through the landing page, account forms, and dashboard.

Density belongs in navigation, metadata, and actions; reading and editing receive breathing room. Structure comes from thin dividers and pale selections rather than ornamental depth. Product demonstrations remain interactive semantic UI, with clear example labeling.

**Key Characteristics:**

- Crisp white surfaces with one blue action accent.
- Compact controls surrounding a spacious editor.
- Geist typography and consistent outline SVG icons.
- Thin dividers, soft corners, and flat tonal layering.
- Brief color feedback and reduced-motion support.

Recorded from `app/globals.css`, `app/styles/landing.css`, `app/styles/workspace.css`, `app/layout.tsx`, and representative brand, demo, account, list, and editor components. This records the completed implementation; the direction contract supplies identity context, not substitute token values.

## Colors

Clear blue punctuates a white and cool-neutral palette; muted text retains legibility instead of disappearing into the chrome.

### Primary

- **Blue:** primary actions, active navigation, text links, carets, focus outlines, and the three-bar brand mark.
- **Blue Hover:** the darker primary-button hover treatment.
- **Pale:** selected notes, quiet informational notices, and icon-button hover surfaces.

### Neutral

- **Background:** the main canvas, editor, fields, and account cards.
- **Foreground:** primary text and headings.
- **Muted:** secondary copy, metadata, inactive controls, and editor/search placeholders.
- **Line:** structural dividers, secondary-button borders, and search outlines.
- **Surface:** sidebar, account-page canvas, quiet hover fills, and the closing landing panel.
- **Field Border / Field Placeholder:** the recurring account-field stroke and placeholder treatment.

Danger and its pale surface identify destructive confirmation controls; error notices use a deeper red text treatment. Success notices use pale green with dark green copy. These are semantic feedback, not additional brand accents.

### Named Rules

**The Action Blue Rule.** Use blue for actions, selection cues, and the brand; keep reading surfaces white or cool off-white.

**The Readable Muted Rule.** Editor and search placeholders use the shared muted text token. Do not restore the lighter editor-placeholder treatment removed during finish review.

## Typography

**Display Font:** Geist, with sans-serif fallback.

**Body Font:** Geist, with sans-serif fallback.

Geist is loaded through Next.js and exposed by the `--font-geist-sans` variable. Geist Mono is also loaded, but no shipped reading or control role uses it; it is not a second design-system voice.

**Character:** medium-weight headings, slightly tight tracking, sentence-case controls, and small metadata. The ramp varies by task rather than following a fixed mathematical ratio.

### Hierarchy

- **Display:** the frontmatter display role belongs to the landing headline. At the tablet breakpoint it is (52px), and on phones (44px).
- **Headline:** landing section headings use (34px, weight 550, line-height 1.2, tracking -.03em), with responsive (28–30px) variants; account headings use (28px, weight 600).
- **Title:** editor titles use (32px, weight 550, line-height 1.3, tracking -.03em), reducing to (27px) below the tablet breakpoint. Workspace headers use (21px, weight 580), then (18px) on phones.
- **Body:** ordinary paragraphs use the frontmatter body role. Landing introductory copy grows to (17px), then (15px) on phones. The note body retains (14px, line-height 1.9) for extended writing.
- **Label:** account labels use the frontmatter label role. Navigation and note titles use (13px), while status and metadata use (10–12px). Labels remain sentence case.

**The Reading Room Rule.** Keep the editor's body text and generous line-height distinct from compact metadata. The miniature landing demo's smaller illustrative text is not a reusable reading size for product content.

## Layout

The landing page shares a centered (1240px) maximum-width frame with (40px) horizontal padding, changing to (24px) below (800px) and (20px) below (600px). The desktop hero pairs editorial copy and the product example; below (800px) those columns stack. Detail rows become one column below (600px).

The dashboard fills (100dvh) and divides into a navigation sidebar (208px), note list (310px), and flexible editor. At (1100px) the sidebar/list reduce to (175px/265px); at (800px) navigation becomes a (64px) icon rail and the list reduces to (230px). Below (600px) the sidebar disappears, header controls take over, and the note list becomes a horizontal strip above the editor. The page then scrolls vertically rather than locking to viewport height.

The editor caps its content width at (880px), with desktop padding (35px 42px) that steps down on smaller screens. Account forms use a (420px) maximum card width, with (36px) internal padding and (28px) on phones. Common spacing is task-specific: small gaps between controls, larger padding around panels, and generous space before reading content. There is no enforced global base-unit grid.

## Elevation & Depth

The shipped UI uses no box shadows. Borders divide adjacent panels; pale fills identify hover, selection, and secondary surfaces. The landing demo has a slight desktop tilt (-1deg), removed below (800px); that is a presentation detail of the example, not a global card transform.

**The Flat Surface Rule.** Use thin dividers and tonal fills to establish structure across the workspace and account surfaces.

## Shapes

Small rounded rectangles define controls: icon buttons use the icon-control radius; fields and navigation use the field radius; buttons, note rows, and notices use the control radius. Larger account cards and landing containers use the container radius. Borders are thin (1px). The account avatar is circular; ordinary action controls are not pills.

The brand is a typographic wordmark beside three blue CSS bars. The middle bar is taller, with gently rounded ends. SVG icons retain the consistent outline grammar from Lucide rather than using Unicode glyphs.

## Components

### Buttons

Compact, clear, and flat. The standard button has a (40px) minimum height; hero actions grow to (46px), and editor toolbar actions shrink to (32px) with smaller text.

- **Primary:** blue with white text; darker blue on hover.
- **Secondary:** white with a neutral stroke; cool surface fill on hover.
- **Quiet:** transparent with muted text; cool surface fill and ink text on hover.
- **Danger:** pale red with danger text for destructive confirmation.
- **Focus:** a blue (2px) outline with (4px) offset. Background and text color transitions last (150ms). Disabled buttons use reduced opacity (.55) and a waiting cursor.
- **Icon control:** square (36px), muted at rest, blue on pale fill when hovered, with an accessible name.

### Cards / Containers

White account cards and demo frames use gently rounded container corners and thin borders. The closing landing panel uses the cool surface fill. No shadow treatment is applied. Card padding follows the surface's density; the account card uses its frontmatter component token, reducing on phones.

### Inputs / Fields

Account fields have white fill, the field border, a field radius, and comfortable compact padding. Labels sit above them. Blue outlines communicate keyboard focus; carets are blue. Search wraps its icon and borderless input in one outlined group; focus is drawn around that group with (2px) offset.

The editor uses borderless title and body fields so writing feels like the content surface itself. Placeholder colors follow the Readable Muted Rule. Error and success messages remain textual notices; disabled state is explicit on pending controls.

### Navigation

Desktop landing links are compact and become blue on hover; the optional detail link disappears on phones. Dashboard links pair line icons and sentence-case text, with a pale blue active fill and blue text. At tablet widths, labels yield to the icon rail. Phone navigation actions live in the header. Focus outlines remain visible for keyboard operation.

### Note Rows and Editor Feedback

Note rows show a title, one-line excerpt, and small date. Long list titles and excerpts truncate, while the editor preserves the full content. A selected row uses pale fill; a hover uses the surface fill. On phones, rows are (190px) wide in the horizontal list.

The editor places quiet saved/unsaved/pending status beside explicit save controls. Attachments sit below a divider, with line icons, readable file links, small size metadata, and controls. Informational, verification, error, and success notices use small rounded tonal blocks.

### Brand and Interactive Example

The CSS three-bar mark and Geist wordmark are the shipped Mio identity. The landing example uses the same rail/list/editor grammar, with sample note buttons exposing pressed state and captions declaring that nothing is saved. Reuse the pattern as live semantic UI when demonstrating product behavior.

| Shipping identity asset | Medium | Provenance |
| --- | --- | --- |
| Mio wordmark and three-bar mark | Semantic text and CSS in `app/components/brand.tsx` | Authored in the Mio implementation; no raster generation. |
| Interface icons | Inline SVG from Lucide | Existing `lucide-react` dependency; no raster generation. |
| `app/favicon.ico` | Inherited raster ICO | Next.js scaffold asset retained unchanged; origin recorded in `app/favicon.ico.json` through Impeccable's format fallback. It is not the Mio brand mark. |

## Do's and Don'ts

### Do:

- **Do** keep blue actions and selection cues consistent across landing, account, and workspace surfaces.
- **Do** preserve readable muted copy, visible focus outlines, and accessible names for icon actions.
- **Do** give editor text breathing room while keeping surrounding controls compact.
- **Do** adapt the workspace through the shipped rail and horizontal-list patterns at smaller widths.
- **Do** keep control feedback brief and honor reduced motion by removing transitions and smooth scrolling.

### Don't:

- **Don't** add extra brand accent palettes, ornamental shadows, or entrance animations to this crisp-white world.
- **Don't** use miniature demo typography as the reading style for full product content.
- **Don't** replace the consistent outline SVG icons with glyph characters.
- **Don't** treat a landing example's tilt or composition as a global container rule.

**Not canonized:** the inherited scaffold favicon is retained asset provenance, not Mio's reusable identity; the loaded but unused mono face and one-off miniature demo values are not reusable typography tokens. No unresolved craft-floor refusal was promoted into a system rule.
