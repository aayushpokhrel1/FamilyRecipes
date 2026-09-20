---
name: Family Recipes
description: The Enamel Vault, a family's recipes as sturdy enamelware on a deep pantry-green wall.
colors:
  wall: "#1f3b34"
  wall-deep: "#16302a"
  wall-edge: "#102420"
  plate: "#f3ede1"
  plate-2: "#e9e1d0"
  ink: "#182b25"
  ink-soft: "#4f605a"
  on-wall: "#f3ede1"
  action: "#d6431f"
  action-deep: "#b53514"
  on-action: "#fdf3ec"
  spark: "#e7c24a"
  chip: "#ddd2bb"
  chip-ink: "#333024"
typography:
  display:
    fontFamily: "Zilla Slab, Rockwell, Roboto Slab, Georgia, serif"
    fontSize: "clamp(2.2rem, 6vw, 3.6rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.005em"
  title:
    fontFamily: "Zilla Slab, Rockwell, Roboto Slab, Georgia, serif"
    fontSize: "clamp(1.25rem, 2.4vw, 1.6rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.01em"
  label:
    fontFamily: "Zilla Slab, Rockwell, Roboto Slab, Georgia, serif"
    fontSize: "0.85rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.1px"
rounded:
  sm: "10px"
  md: "14px"
  pill: "999px"
spacing:
  gut: "24px"
  sm: "10px"
  md: "18px"
  lg: "26px"
components:
  button:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-action:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  chip:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.chip-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "22px 24px"
  input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  nav-tab:
    textColor: "{colors.on-wall}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 13px"
---

# Design System: Family Recipes

## Overview

**Creative North Star: "The Enamel Vault"**

A family's recipes are the everyday enamelware of a shared kitchen: sturdy bone plates
racked on a deep spruce-green pantry wall, made to be used and handed down, never
precious. The whole product lives on one saturated green ground; content rides on
rimmed bone enamel surfaces; and a single vermilion signal marks the one action that
commits. It is warm and domestic without softening into the cream-paper recipe magazine,
and structured and confident without cooling into a gray dashboard.

The world was chosen against a hard brief: it must feel neither corporate, nor trendy,
nor clinical, nor twee. Enamelware answers all four at once. The saturated green and the
industrial signage lettering keep it from the SaaS grays and the of-the-moment editorial
serif; the bone plates and the human provenance stamp keep it from feeling like a lab;
and the sturdy slab type (never folksy script, never heavy speckle) keeps warmth from
curdling into country-kitchen kitsch. The register is Operate: recipes are labeled to be
scanned and opened fast, and the recipe reading itself is given room to breathe.

**Key Characteristics:**
- A deep enamel-green ground owns the whole surface; bone plates carry all content.
- Sturdy slab signage (Zilla Slab) in caps for every title, label, and control.
- Exactly one vermilion signal, reserved for the committing action.
- Physical depth: a dark rim plus an inner highlight, lifted by one soft shadow.
- Provenance shown as a stamped maker's mark, not a footnote.

## Colors

A committed, saturated palette: one deep green field, one bone content surface, one
reserved signal, tied together with green-tinted inks.

### Primary
- **Spruce Enamel** (`#1f3b34`): the pantry wall. The app ground and all chrome. It owns
  whole regions, never scattered as an accent.
- **Enamel Deep** (`#16302a`): the header rail, the plate rim keyline, and meta tags. The
  structural shade of the green.

### Secondary
- **Vermilion Signal** (`#d6431f`): the one reserved action color. Primary buttons, step
  markers, ingredient quantities, monograms, the provenance stamp, and every themed
  browser surface (selection, caret, scrollbar, focus ring). Deepens to **Vermilion Deep**
  (`#b53514`) on press.

### Tertiary
- **Enamel Yellow** (`#e7c24a`): the live tick only. The active nav tab's underglow and
  emphasized figures in meta tags. Rare by design.

### Neutral
- **Bone Enamel** (`#f3ede1`): content plates and all text set on the green wall.
- **Bone Shade** (`#e9e1d0`): plate inset surfaces and stripes.
- **Enamel Ink** (`#182b25`): primary text on bone plates.
- **Enamel Ink Soft** (`#4f605a`): secondary text on bone, tinted from the green.
- **Tin Label** (`#ddd2bb`) with ink **Tin Ink** (`#333024`): chips and tags.

### Named Rules
**The One Signal Rule.** Vermilion is only ever the committing action, at most one per
viewport. It is never decoration; when it appears, it is the thing to press.

**The Wall Rule.** The enamel green owns the ground and chrome. Content does not float on
it inside a container without becoming a bone plate; only plain running text sits directly
on the wall, in bone.

**The Tinted-Secondary Rule.** Secondary text is tinted from the green (`--ink-soft`,
`--on-wall-soft`), never neutral gray. Gray on this world reads as an accident.

## Typography

**Display / Sign Font:** Zilla Slab (with Rockwell, Roboto Slab, Georgia, serif)
**Body Font:** the system humanist sans (system-ui)
**Label Font:** Zilla Slab, tracked caps

**Character:** a sturdy slab does the signage, painted-enamel work: titles, labels, and
controls all speak in it, in caps. The system sans keeps body copy plainly legible in a
working kitchen. The pairing is confident and utilitarian, not decorative.

### Hierarchy
- **Display** (700, `clamp(2.2rem, 6vw, 3.6rem)`, 1.05): page and recipe titles, set as
  full-width enamel signs in caps.
- **Title** (700, `clamp(1.25rem, 2.4vw, 1.6rem)`, 1.05): panel headings (Ingredients,
  Steps), uppercase and tracked.
- **Label** (600, ~0.85rem, tracked 0.05em, uppercase): buttons, nav tabs, chips, meta
  tags, the plate titles in the grid.
- **Body** (400, 17px, 1.5): recipe text, stories, comments. The system sans.

### Named Rules
**The Sign Rule.** Every title, label, and control is Zilla Slab in caps. A title shrunk
to a timid mixed-case label has left the world; the type carries the composition.

## Layout

A single centered column (max-width 1180px) sits on the full-viewport green wall, edged
with a hairline and a top gradient so the wall reads as a panel. The header is a full-width
sign-rail; content lives in `.app-main` with a 24px gutter (16px on phones). The recipe
grid is `auto-fill, minmax(230px, 1fr)`, so plates reflow from four columns down to one.
The recipe body is a two-column spread (a ~300px ingredients rail beside a fluid steps
column) that stacks to one column below 720px. Spacing rhythm is generous between plates
(18px grid gap, 20px between stacked sections) and tight within them, with more space above
a heading than below it.

## Elevation & Depth

Depth is physical and enamel, not soft-UI. Every plate and control carries a **rim**: a
1.5px dark keyline (`--rim`) plus an inner top highlight (`inset 0 1.5px 0` in
`--rim-hi`), which reads as the rolled edge of enamelware. On top of the rim, one soft
structural shadow (`--lift`, offset and blurred) floats the plate off the wall. Controls
press physically: they lift 1px on hover and sink with an inset shadow on `:active`.

### Shadow Vocabulary
- **Lift** (`0 14px 26px -14px rgba(6,18,15,0.55)`): plates and cards at rest.
- **Lift-sm** (`0 4px 10px -4px rgba(6,18,15,0.4)`): buttons and controls at rest.

### Named Rules
**The Enamel Edge Rule.** Depth is a rim (dark keyline + inner highlight) plus one soft
shadow. Never a zero-blur block shadow; this world is enamel, not neobrutalism.

## Shapes

Generously rounded rectangles throughout: 14px for plates and cards, 10px for controls,
inputs, and tags, full pill for chips. Every enclosed surface takes the rim keyline.
Signature marks: the provenance **stamp** is a vermilion outline rounded rectangle rotated
about 2.5 degrees, like a rubber or enamel maker's mark; step numbers are vermilion enamel
plaques (rounded squares); the wordmark is a bone sign inside a vermilion-bordered plate.

## Components

### Buttons
- **Shape:** rounded 10px, rim keyline, Zilla Slab caps.
- **Neutral (default):** bone plate face, enamel ink, used for secondary actions (Edit,
  Sign out, Delete).
- **Action:** vermilion face, bone text, `action-deep` border, a soft vermilion shadow.
  The single committing control per view (New recipe, Cook Mode).
- **Hover / Active:** lift 1px on hover; sink with an inset shadow on press.

### Chips / Tags
- **Chip (visibility):** tin-label fill, tin ink, pill, rim border, tracked caps.
- **Meta tag (serves / times):** enamel-deep fill on the wall, bone text, with the figure
  emphasized in enamel yellow.

### Cards / Plates
- **Corner:** 14px. **Background:** bone. **Rim:** dark keyline + inner highlight.
- **Shadow:** the Lift shadow (see Elevation). **Padding:** 18-24px.
- **Recipe plate (grid):** a label-first tile, a large vermilion monogram, the title in
  slab caps pushed to the bottom, a visibility chip. No stock photo stand-ins.

### Inputs / Fields
- **Style:** bone fill, rim keyline + inner highlight, 10px radius. Selects carry a drawn
  caret in ink (no OS chrome).
- **Focus:** vermilion border plus a soft vermilion focus ring.

### Navigation
- **Style:** the header sign-rail (enamel-deep). Wordmark sign at left, tracked-caps tabs.
- **States:** active tab gets a dark inset fill and an enamel-yellow underglow; hover
  lightens. Wraps to its own full-width row on phones.

### Provenance stamp (signature)
A vermilion outline rounded rectangle, tracked caps, rotated ~2.5 degrees, heading the
provenance panel. It is the emotional signature of the world: the hand behind the recipe.

## Do's and Don'ts

### Do:
- **Do** reserve vermilion (`#d6431f`) for the one committing action in a view; everything
  else is bone, green, or tin.
- **Do** set every title, label, and control in Zilla Slab caps; keep titles at sign scale.
- **Do** give every surface the enamel rim (dark keyline + inner highlight) and lift it
  with one soft shadow.
- **Do** tint secondary text from the green (`--ink-soft`, `--on-wall-soft`).
- **Do** theme the browser surfaces (selection, caret, scrollbar, focus ring,
  `accent-color`) from the palette.

### Don't:
- **Don't** put more than one vermilion action in a viewport, or use it as decoration.
- **Don't** reach for cream/parchment grounds or delicate display serifs; that is the
  category default this world exists to refuse.
- **Don't** use folksy script or heavy speckle; warmth here is sturdy, not saccharine.
- **Don't** use glass, blur, gradient text, or zero-blur block shadows.
- **Don't** float content directly on the green inside a container; make it a bone plate.
