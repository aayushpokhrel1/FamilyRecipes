# Brief: Slice 6 — AI prefill on edit (append merge)

Let the AI extract panel be used while editing a saved recipe. On edit, its result is MERGED
into the current draft (append ingredients/steps, fill only empty scalars, never overwrite
existing text or the title), not replaced.

## 1. Create `src/lib/mergeDraft.ts` EXACTLY

```ts
import type { RecipeDraft } from "./api/types";

// Merge an AI-extracted draft into the current one for editing: append the lists, fill only
// empty scalar fields, and never overwrite existing text (including the title).
export function mergeDraft(current: RecipeDraft, incoming: RecipeDraft): RecipeDraft {
  return {
    title: current.title || incoming.title,
    story: current.story || incoming.story,
    provenance: current.provenance || incoming.provenance,
    servings: current.servings ?? incoming.servings,
    prep_minutes: current.prep_minutes ?? incoming.prep_minutes,
    cook_minutes: current.cook_minutes ?? incoming.cook_minutes,
    source_url: current.source_url ?? incoming.source_url,
    ingredients: [...current.ingredients, ...incoming.ingredients],
    steps: [...current.steps, ...incoming.steps],
  };
}
```

## 2. Create `src/lib/mergeDraft.test.ts` EXACTLY

```ts
import { test, expect } from "vitest";
import { mergeDraft } from "./mergeDraft";
import type { RecipeDraft } from "./api/types";

const base = (o: Partial<RecipeDraft>): RecipeDraft => ({
  title: "", story: "", provenance: "", servings: null, prep_minutes: null, cook_minutes: null,
  ingredients: [], steps: [], source_url: null, ...o,
});

test("appends lists, fills empty scalars, never overwrites existing text", () => {
  const current = base({
    title: "Nana's Dal", servings: 4,
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "lentils" }],
    steps: [{ position: 0, text: "Boil" }],
  });
  const incoming = base({
    title: "Dal Extracted", servings: 8, story: "from a blog",
    ingredients: [{ position: 0, quantity: "2", unit: null, item: "tomato" }],
    steps: [{ position: 0, text: "Simmer" }],
  });
  const merged = mergeDraft(current, incoming);
  expect(merged.title).toBe("Nana's Dal");
  expect(merged.servings).toBe(4);
  expect(merged.story).toBe("from a blog");
  expect(merged.ingredients.map((i) => i.item)).toEqual(["lentils", "tomato"]);
  expect(merged.steps.map((s) => s.text)).toEqual(["Boil", "Simmer"]);
});
```

## 3. Edit `src/pages/RecipeEdit.tsx`

(a) Add imports (with the other imports):
```tsx
import AiPrefillPanel from "../components/AiPrefillPanel";
import { mergeDraft } from "../lib/mergeDraft";
```

(b) Add a handler inside the component (near `handleSubmit`):
```tsx
  function handlePrefill(incoming: RecipeDraft) {
    setDraft((cur) => (cur ? mergeDraft(cur, incoming) : incoming));
  }
```

(c) In the returned JSX, immediately AFTER the `{error && <p role="alert">{error}</p>}` line
and BEFORE the `<form onSubmit={handleSubmit}>` line, insert:
```tsx
      <AiPrefillPanel onDraft={handlePrefill} />
```

## Constraints
- Use the code verbatim. Do not modify any other file. Do not touch brief.md. Do not run commands.
- No em/en dashes anywhere.
