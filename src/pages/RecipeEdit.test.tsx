import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

// This page had NO test file at all while carrying two fixes that were only ever pinned on
// RecipeCreate: the optional/alt_group columns surviving an edit, and the batched-setDraft
// stale closure. Both are page-level bugs, invisible in the components and invisible on
// screen, so the only place to catch them is what reaches the API on save.

const baseRecipe = {
  id: "r1", family_id: "f1", title: "Paneer", story: "", provenance: "",
  servings: 4, prep_minutes: null, cook_minutes: null, source_url: null,
  visibility: "family" as const,
};

async function renderEdit(mocks: {
  getRecipe: ReturnType<typeof vi.fn>;
  updateRecipe: ReturnType<typeof vi.fn>;
  extract?: unknown;
}) {
  vi.doMock("../lib/api/recipes", () => ({
    getRecipe: mocks.getRecipe,
    updateRecipe: mocks.updateRecipe,
    listFamilyIngredientNames: vi.fn().mockResolvedValue([]),
    listFamilySectionNames: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("../lib/api/tags", () => ({
    getRecipeTagIds: vi.fn().mockResolvedValue([]),
    setRecipeTags: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    ensureTag: vi.fn(),
  }));
  vi.doMock("../lib/api/photos", () => ({ uploadRecipePhoto: vi.fn() }));
  if (mocks.extract) {
    vi.doMock("../lib/api/extract", () => ({ extractRecipe: vi.fn().mockResolvedValue(mocks.extract) }));
  }

  vi.resetModules();
  const { default: Page } = await import("./RecipeEdit");
  render(
    <MemoryRouter initialEntries={["/recipes/r1/edit"]}>
      <Routes><Route path="/recipes/:id/edit" element={<Page />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: /edit recipe/i });
}

function unmockAll() {
  vi.doUnmock("../lib/api/recipes");
  vi.doUnmock("../lib/api/tags");
  vi.doUnmock("../lib/api/photos");
  vi.doUnmock("../lib/api/extract");
}

// The regression the handover flagged as unguarded, and it is the shape of the 0009 bug:
// a column that loads fine, displays fine, and is silently dropped on the way back out.
// An edit that never touches the ingredients must still return them whole.
test("optional, alternatives and sections survive an edit that touches only the title", async () => {
  const updateRecipe = vi.fn().mockResolvedValue(undefined);
  await renderEdit({
    updateRecipe,
    getRecipe: vi.fn().mockResolvedValue({
      recipe: baseRecipe,
      ingredients: [
        { position: 0, quantity: "100", unit: "ml", item: "cream", section: "For the sauce", optional: false, alt_group: "g1" },
        { position: 1, quantity: "100", unit: "ml", item: "yogurt", section: "For the sauce", optional: false, alt_group: "g1" },
        { position: 2, quantity: null, unit: null, item: "basil", section: null, optional: true, alt_group: null },
      ],
      steps: [{ position: 0, text: "Simmer" }],
      photos: [],
    }),
  });

  fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "Paneer Butter Masala" } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(updateRecipe).toHaveBeenCalled());

  const patch = updateRecipe.mock.calls[0][1];
  expect(patch.title).toBe("Paneer Butter Masala");
  expect(patch.ingredients).toEqual([
    expect.objectContaining({ item: "cream", section: "For the sauce", optional: false, alt_group: "g1" }),
    expect.objectContaining({ item: "yogurt", section: "For the sauce", optional: false, alt_group: "g1" }),
    expect.objectContaining({ item: "basil", optional: true, alt_group: null }),
  ]);
  unmockAll();
  // This one renders the whole editor with a full ingredient list and measured 5337ms against
  // vitest's 5000ms default on a dev machine, failing as a TIMEOUT that reads exactly like an
  // assertion failure. CI is slower, so the headroom is deliberate.
}, 30000);

// The same batched-setDraft collision RecipeCreate is pinned against. StepEditor calls
// onChange (steps) and onIngredientsFound in one tick; a `{ ...draft }` spread off the render
// closure loses whichever landed first. Driven through Tidy, not the mic: mocking useRecorder
// hooks AiPrefillPanel, which renders first, so the wrong callback gets captured.
// The loaded recipe must have no ingredient text, or onIngredientsFound bails out early and
// the two writes never collide.
test("model steps survive a save that also fills in ingredients", async () => {
  const updateRecipe = vi.fn().mockResolvedValue(undefined);
  await renderEdit({
    updateRecipe,
    getRecipe: vi.fn().mockResolvedValue({
      recipe: baseRecipe, ingredients: [], steps: [], photos: [],
    }),
    extract: {
      title: "", story: "", provenance: "", servings: null, prep_minutes: null, cook_minutes: null,
      source_url: null,
      ingredients: [{ position: 0, quantity: null, unit: null, item: "onion", note: null, section: null }],
      steps: [
        { position: 0, text: "Cook the onion until golden" },
        { position: 1, text: "Simmer for twenty minutes" },
      ],
    },
  });

  fireEvent.change(screen.getByPlaceholderText(/one step per line/i), {
    target: { value: "cook the onion then simmer it for ages" },
  });
  fireEvent.click(screen.getByRole("button", { name: /tidy into steps/i }));
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(updateRecipe).toHaveBeenCalled());

  const patch = updateRecipe.mock.calls[0][1];
  expect(patch.steps.map((s: { text: string }) => s.text)).toEqual([
    "Cook the onion until golden",
    "Simmer for twenty minutes",
  ]);
  expect(patch.ingredients.map((i: { item: string }) => i.item)).toEqual(["onion"]);
  unmockAll();
});

// A save that blows up here costs an edit someone already typed, so it must leave a trace
// under its own context, not the create page's.
test("a failed save reports itself as save:recipe-edit", async () => {
  const reportError = vi.fn();
  vi.doMock("../lib/api/errorLog", () => ({ reportError }));
  await renderEdit({
    updateRecipe: vi.fn().mockRejectedValue(new Error("db is on fire")),
    getRecipe: vi.fn().mockResolvedValue({
      recipe: baseRecipe, ingredients: [], steps: [], photos: [],
    }),
  });

  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(reportError).toHaveBeenCalledWith("save:recipe-edit", expect.any(Error)));
  expect(await screen.findByText(/db is on fire/i)).toBeInTheDocument();
  vi.doUnmock("../lib/api/errorLog");
  unmockAll();
});
