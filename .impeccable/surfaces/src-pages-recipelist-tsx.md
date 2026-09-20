---
version: 1
slug: "src-pages-recipelist-tsx"
primary_target: "src/pages/RecipeList.tsx"
related_targets: ["src/pages/RecipeDetail.tsx","src/index.css"]
---

# Surface brief: Vault home + Recipe detail (The Enamel Vault)

**Scope & mode.** The vault home (`src/pages/RecipeList.tsx`) and recipe detail
(`src/pages/RecipeDetail.tsx`), which together establish the app-wide visual system.
Because every page is unstyled semantic HTML driven by one global stylesheet
(`src/index.css`), the system built here cascades to the whole app. Mode: **Operate**
(a daily-use family recipe app), with the recipe-detail reading given Experience-grade craft.

**Audience, job, action.** Everyday home cooks inside a family. Job: find and open a
family recipe to cook or read, and keep the vault. Path: browse labeled plates -> open a
recipe -> cook or edit. Primary actions: add a recipe, and start Cook Mode.

**Proof / content.** Real recipe content only (title, photo, ingredients, steps, story,
provenance, tags, contributor). No fabricated customers, counts, or claims.

**Constraints.** Keep all functionality, routes, behavior, and factual copy. Keep working
light + dark mode. Stay lightweight: CSS-first, at most one web font, no UI libraries;
data access stays behind `src/lib/api/`. (User: keep function & copy; free rein otherwise.)

**Memorable moment.** The pantry wall: bone enamel recipe plates on a deep enamel-green
ground, each stamped with its provenance mark, one vermilion control as the single action.

**Unresolved (decide at build).** Dark-mode green/vermilion tuning; speckle intensity;
final signage face (Zilla Slab vs. a sturdier grotesque).

## Direction contract

**THESIS.** A family's recipes are the everyday enamelware of a shared kitchen: each
recipe is a labeled enamel plate on the pantry wall, sturdy, made to be used and handed
down, never precious. It refuses both the cream-paper editorial recipe magazine and the
gray SaaS recipe manager.

**OWN-WORLD.** A deep spruce-enamel green ground (the pantry wall) carries the app chrome.
Content rides on bone enamel plates with a dark rim keyline, a thin inner-edge highlight,
hard structural drop shadows, and a restrained speckle texture. One reserved vermilion
signal is always the primary / commit action, never decoration. Titles set in a bold slab
at poster / sign scale; labels in small tracked slab caps; body in a system humanist sans
for kitchen legibility. Tags are small tin-label chips; provenance is a stamped vermilion
maker's mark. Recognizable with all content removed: green wall, bone rimmed plates, one
orange control, slab caps.

**STORY.** The cook lands and sees their family's pantry wall, not a feed; scans labeled
plates, opens one, and reads a recipe that visibly carries a person's name and a lineage
stamp. The single vermilion control is the unmistakable next action, add or cook.

**FIRST VIEWPORT.** Vault home: enamel-green ground; a top sign-rail with "Family Recipes"
in poster-scale slab caps, the family switcher, and the one vermilion "New recipe" button
at right. Below, a responsive grid of bone recipe plates, each with a dish photo behind an
enamel frame, the title in bold slab caps, tin-label tag chips, and a stamped provenance
mark. Recipe detail: title as a full-width enamel sign, provenance stamp beneath, a
two-column enamel spread (ingredients as a ruled enamel list, steps as numbered enamel
plaques), photo in an enamel frame; Cook Mode and edit as enamel controls, the primary one
in vermilion. Raised (from the hardware-bench challenger): one vermilion signal, always the
commit action, with real enamel-button press states. Raised (from the Emigre specimen):
title type at poster scale as the composition, never a timid label.

**FORM.** Kitchen enamelware / pantry-tin signage. Position on the ordered grounded list:
#6 (assigned by the roll; my ranking led with the compiled cookbook). Seed key 03679533.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
