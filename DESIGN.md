---
name: Genesis
description: AI-powered HighLevel app builder — a dark, dense IDE-like workspace for streaming a working Vue mini-app into existence
colors:
  signal-amber: "#e8bd62"
  signal-amber-ink: "#1b1914"
  near-black-bg: "#11110f"
  surface: "#161613"
  surface-raised: "#1d1c18"
  panel-header: "#151512"
  border-hairline: "#34332d"
  input-border: "#3a382f"
  ink-primary: "#eeeae0"
  ink-muted: "#8c8980"
  danger: "#b3453f"
typography:
  display:
    fontFamily: "Geist, 'Avenir Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6.2vw, 5.125rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.065em"
  headline:
    fontFamily: "Geist, 'Avenir Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.875rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.06em"
  title:
    fontFamily: "Geist, 'Avenir Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Geist, 'Avenir Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.1em"
rounded:
  sm: "5px"
  md: "7px"
  lg: "8px"
  xl: "9px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.signal-amber-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-amber}"
  button-outline:
    backgroundColor: "{colors.near-black-bg}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
  badge-active:
    backgroundColor: "transparent"
    textColor: "{colors.signal-amber}"
    rounded: "9999px"
---

# Design System: Genesis

## Overview

**Creative North Star: "The Workshop Bench"**

Genesis looks like a tool-maker's bench, not a marketing surface: dark and unfussy, every panel earns its place, and the one warm accent color marks what's active or worth touching — the way a marked tool stands out on a dark workbench. There is exactly one theme (always dark; no light mode, no toggle) because the product is a working console, not a brand showcase. Chrome recedes — hairline borders, stepped near-black surfaces, uppercase monospace micro-labels — so the three things that actually matter (chat, code, live preview) can sit side by side without competing for attention.

The system rejects: light backgrounds, decorative gradients or illustration, multiple accent colors, drop shadows as a default depth device, and centered/marketing-style page compositions anywhere inside the authenticated app.

**Key Characteristics:**
- Always-dark, single-theme — depth from tonal steps, not shadows
- One accent (Signal Amber) used only for what's active, primary, or needs attention
- Dense, monospace micro-labels doing structural/status work (`IBM Plex Mono`, uppercase, wide tracking)
- Geist for everything a human reads at length; monospace for everything a human scans
- Compact controls (28–40px control heights, 5–9px radii) — instrumentation, not billboard

## Colors

A near-black neutral scale with a single warm accent; no secondary or tertiary hue exists anywhere in the product.

### Primary
- **Signal Amber** (`#e8bd62`): the sole accent. Brand mark, primary button, active tab underline, active file-tree row, focus rings, links, and anything that means "current" or "act on this." Its ink pairing on-fill is near-black (`#1b1914`), never white.

### Neutral
- **Near-Black** (`#11110f`): base app background; also the outermost auth/dashboard page background.
- **Surface** (`#161613`): workspace panel background (chat/code/preview), one step up from base.
- **Surface Raised** (`#1d1c18`): cards, dialogs, hover states on interactive rows — the topmost neutral tier.
- **Panel Header** (`#151512`): topbar, dashboard nav, statusbar — a distinct darker band that frames content panels.
- **Ink Primary** (`#eeeae0`): default body/heading text on dark.
- **Ink Muted** (`#8c8980`): secondary text, timestamps, helper copy, placeholder-adjacent labels.
- **Border Hairline** (`#34332d`): the only border color at rest; separates every panel, row, and card.
- **Danger** (`#b3453f`): destructive actions and error states only (attention badges, error banners, destructive button fill).

### Named Rules
**The One Accent Rule.** Signal Amber is the only saturated color in the interface. Every other surface is a shade of near-black; every other piece of feedback (error, muted, disabled) uses desaturated tones. If a screen needs a second "important" color, that is a sign the hierarchy is wrong, not that the palette needs a second accent.

## Typography

**Display/Body Font:** Geist (with "Avenir Next", ui-sans-serif, system-ui, sans-serif fallback)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace fallback)

**Character:** Geist is neutral and slightly condensed at display sizes (tight negative letter-spacing on large headlines), doing the human-readable talking. IBM Plex Mono is reserved entirely for structural and status text — panel labels, timestamps, file names, badges — so the eye can tell "content" from "chrome" at a glance without color alone.

### Hierarchy
- **Display** (400, `clamp(2.75rem, 6.2vw, 5.125rem)`, line-height 0.98, tracking -0.065em): the auth page's hero line only — the one place Genesis makes a pitch.
- **Headline** (400, `clamp(2.25rem, 5vw, 3.875rem)`, line-height 1.05, tracking -0.06em): dashboard's page-level heading ("Your projects").
- **Title** (500, 22–27px, tracking -0.035em to -0.04em): dialog and form headings (auth form, project dialog, snapshot dialog).
- **Body** (400, 13px, line-height 1.65): chat messages and default UI copy.
- **Label** (600, 9–11px, tracking 0.08–0.1em, uppercase, IBM Plex Mono): panel headings, message role tags, file tree entries, statusbar, editor tabs.

### Named Rules
**The Mono-Means-Structure Rule.** If text is naming *where you are* or *what state something is in* (a panel heading, a tab, a status badge, a timestamp) it is uppercase IBM Plex Mono. If it is content a human wrote or is reading (chat prose, dialog descriptions, form labels-as-sentences) it is Geist.

## Layout

Genesis is a fixed-viewport IDE shell above ~1020px: a 56px topbar, a three-column resizable workspace (`chat : code : preview` at roughly `0.72fr : 1.16fr : 1.12fr`, 270/410/360px minimums), and a 25px statusbar, with `min-height`/`max-height: 100dvh` and internal scroll only — the page itself never scrolls. Panel widths are user-draggable via a `panel-resizer` and transition on width change (`240ms cubic-bezier(0.4, 0, 0.2, 1)`); a panel can collapse to a thin rail. Below 1020px the three panels stack into a single active panel switched by a bottom `mobile-tabs` bar (chat/code/preview), and the resizer/collapse affordances disappear entirely rather than trying to persist on touch.

Marketing-adjacent pages (auth, dashboard) use a generous editorial layout instead of the dense workspace grid: auth is a two-column split (copy left, form right, `1.08fr : 0.92fr` above 780px, stacking below it); the dashboard content column caps at `1120px` centered with `72px` vertical padding. Spacing steps in the dense workspace run small (4–18px); the editorial pages breathe more (24–88px, using `clamp()` for horizontal page padding).

## Elevation & Depth

Genesis is flat at rest, layered by tone rather than lifted by shadow: depth comes from three stepped near-black surfaces (`#11110f` → `#161613` → `#1d1c18`) plus a single hairline border color, not from box-shadow. Shadows are reserved for the small set of things that genuinely float above the page — dialogs, sheets, and dropdown-style overlays inherit shadcn's default `shadow-lg`/`shadow-xs`, and the live-preview "generating" mask uses a backdrop-blur scrim rather than a shadow to separate itself from the iframe beneath it.

### Named Rules
**The Flat-By-Default Rule.** A panel, card, or row is flat at rest. Reach for a shadow only for a true overlay (modal, sheet, popover) — never to add visual weight to something that sits in normal document flow.

## Shapes

Small, consistent rounding across the whole system: a single `--radius` primitive (0.625rem / 10px) is stepped down for compact controls (`--radius-sm` = 6px, `--radius-md` = 8px) and up for containers (`--radius-lg` = 10px, `--radius-xl` = 14px), landing most real controls at 5–9px in practice (buttons/inputs at 6–8px, cards/dialogs/connection rows at 7–9px). Borders are always 1px and always `border-hairline` at rest. Badges are the one fully-round exception (`rounded-full`), used for small status pills. Nothing in the system uses heavy rounding, sharp squared corners, or asymmetric/cut corners.

## Components

Every control is compact and instrumented — dense padding, small type, monospace micro-labels — never a large marketing-style hero control.

### Buttons
- **Shape:** 6–8px radius (`rounded-md`), 1px border only on the outline variant.
- **Primary:** Signal Amber fill, near-black-on-amber text (`#1b1914`), `36px` default height (`h-9`), `16px` horizontal padding; the *only* saturated button in the system.
- **Secondary/Outline/Ghost:** transparent or near-black background, hairline border (outline only), hover shifts to Surface Raised — never colored.
- **Destructive:** `#b3453f` fill with white text, reserved for irreversible actions (delete project, discard).
- **Sizes:** `xs`(24px)/`sm`(32px)/`default`(36px)/`lg`(40px), plus square icon-only variants at matching heights.

### Badges
- **Style:** fully rounded pill, 2–8px horizontal padding, 10–11px text.
- **State:** a neutral/default pill for status text (e.g. connection state) turns Signal Amber-bordered/text when "active"; nothing else changes color.

### Cards / Containers
- **Corner Style:** 7–9px radius.
- **Background:** Surface or Surface Raised, one tone up from whatever sits behind it.
- **Shadow Strategy:** none at rest (see Elevation & Depth); dialogs/sheets get `shadow-lg`.
- **Border:** 1px hairline, always.
- **Internal Padding:** compact, 12–18px.

### Inputs / Fields
- **Style:** hairline border, transparent/near-black background, 6px radius, 36px height for single-line inputs.
- **Focus:** border shifts to a warm mid-tone plus a 3px Signal-Amber-tinted ring (`focus-visible:ring-3`) — never a glow or scale change.
- **Error/Disabled:** invalid state tints the border/ring toward Danger; disabled drops to 50% opacity and blocks pointer events.

### Navigation
- **Topbar:** 56px, three-zone grid (brand / project switcher+status / actions), Panel Header background, hairline bottom border.
- **Tabs (editor tabs, mobile section tabs):** flat, IBM Plex Mono uppercase labels, active state marked by a Signal Amber top or bottom border rather than a filled pill.
- **File tree:** flat list, 5px-radius rows, hover to Surface Raised, active row gets Surface Raised background + Signal Amber text.

### Chat Message (signature component)
The chat panel's message list is the product's signature surface: each message is unstyled except a small uppercase mono role label above it (user messages additionally get a Surface Raised background + left-inset, so a skim down the panel reads as alternating "who said this" without needing avatars or bubbles on both sides.

## Do's and Don'ts

### Do:
- **Do** keep Signal Amber (`#e8bd62`) as the only saturated color anywhere in the authenticated app.
- **Do** build depth from the three-step near-black tonal ladder (`#11110f` → `#161613` → `#1d1c18`) plus hairline borders before reaching for a shadow.
- **Do** set structural/status text (panel labels, tabs, badges, timestamps) in uppercase IBM Plex Mono; keep everything a human composes or reads at length in Geist.
- **Do** keep controls compact (28–40px heights, 5–9px radii) — this is an instrument panel, not a marketing page.

### Don't:
- **Don't** introduce a light theme or a theme toggle — Genesis is deliberately always dark.
- **Don't** add a second accent hue; a new "important" color signals a hierarchy problem, not a palette gap.
- **Don't** apply drop shadows to panels, cards, or rows that sit in normal document flow — reserve shadows for true overlays (dialog, sheet, popover).
- **Don't** carry the dense workspace grid's tight spacing into the editorial auth/dashboard pages, or vice versa — the two layout registers are intentionally different.
