# Brief: Slice 7 — add a recipe to a My Kitchen plan from the recipe page

Add an "Add to plan" control on the recipe detail page. It lists the caller's plans and adds
the recipe (unscheduled) to the chosen one via the existing `addRecipe` API.

## 1. Edit `src/pages/RecipeDetail.tsx`

(a) Add imports (with the others):
```tsx
import { listPlans, addRecipe } from "../lib/api/mealPlans";
```
And change the types import to include `MealPlan`:
FROM:
```tsx
import type { Ingredient, Recipe, Step } from "../lib/api/types";
```
TO:
```tsx
import type { Ingredient, Recipe, Step, MealPlan } from "../lib/api/types";
```

(b) Add state near the other useState calls:
```tsx
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [addMsg, setAddMsg] = useState("");
```

(c) Add an effect that loads the plans once (place it after the existing load effect):
```tsx
  useEffect(() => {
    listPlans().then(setPlans).catch(() => setPlans([]));
  }, []);
```

(d) Add a handler (near `handleDelete`):
```tsx
  async function handleAddToPlan() {
    if (!id || !planId) return;
    try {
      await addRecipe(planId, id);
      const name = plans.find((p) => p.id === planId)?.name ?? "plan";
      setAddMsg("Added to " + name);
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : String(err));
    }
  }
```

(e) In the `<div className="recipe-actions">` block, immediately BEFORE the
`<span className="spacer" />` line, insert:
```tsx
        {plans.length > 0 && (
          <>
            <select aria-label="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Add to plan...</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" onClick={handleAddToPlan} disabled={!planId}>Add to plan</button>
          </>
        )}
```

(f) Immediately AFTER the `{error && (...)}` block (the one with `role="alert"`), insert:
```tsx
      {addMsg && <p className="vault-note">{addMsg}</p>}
```

## 2. Edit `src/pages/RecipeDetail.test.tsx`

(a) After the existing `vi.mock("../lib/api/recipes", ...)` block, ADD a mealPlans mock:
```tsx
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([
    { id: "p1", owner_id: "u", family_id: "f1", name: "This week", view_mode: "list",
      is_shared: false, checked_items: [], created_at: "", updated_at: "" },
  ]),
  addRecipe: vi.fn(),
}));
```

(b) APPEND a new test (keep the existing one unchanged):
```tsx
test("shows an add-to-plan control listing the user's plans", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("button", { name: /add to plan/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "This week" })).toBeInTheDocument();
});
```

## Constraints
- Use the code verbatim. Do not modify any other file. Do not touch brief.md. Do not run commands.
- No em/en dashes anywhere.
