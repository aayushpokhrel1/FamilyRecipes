import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import RecipeCreate from "./RecipeCreate";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" },
  }),
}));

test("renders the guided create form", () => {
  render(
    <MemoryRouter>
      <RecipeCreate />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: /add ingredient/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument();
});

// The bug Aayush hit: dictate steps, watch them appear in the box, save, and the spoken steps
// are gone while the ingredients the same call found are kept.
//
// StepEditor calls onChange (steps) and onIngredientsFound in the SAME tick. React batches the
// two setDraft calls, and both used to spread `draft` from the render closure, so the second one
// wrote back the steps from BEFORE the first. Nothing looked wrong on screen, because StepEditor
// owns its own text; the loss existed only in the parent and only surfaced on save.
//
// Driven through Tidy rather than the mic, because Tidy takes the identical path (one
// extractRecipe call, then onChange and onIngredientsFound together) and is unambiguous to
// click. Mocking useRecorder here would hook the wrong component: AiPrefillPanel uses it too,
// and it renders FIRST. The mic's own hazard, a stale text closure, is pinned in
// StepEditor.test.tsx.
test("model steps survive a save that also fills in ingredients", async () => {
  const createRecipe = vi.fn().mockResolvedValue({ id: "r1" });
  vi.doMock("../lib/api/recipes", () => ({
    createRecipe,
    listFamilyIngredientNames: vi.fn().mockResolvedValue([]),
    listFamilySectionNames: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("../lib/api/tags", () => ({ setRecipeTags: vi.fn(), listTags: vi.fn().mockResolvedValue([]) }));
  vi.doMock("../lib/api/extract", () => ({
    extractRecipe: vi.fn().mockResolvedValue({
      title: "", story: "", provenance: "", servings: null, prep_minutes: null, cook_minutes: null,
      source_url: null,
      ingredients: [{ position: 0, quantity: null, unit: null, item: "onion", note: null, section: null }],
      steps: [
        { position: 0, text: "Cook the onion until golden" },
        { position: 1, text: "Simmer for twenty minutes" },
      ],
    }),
  }));

  vi.resetModules();
  const { default: Page } = await import("./RecipeCreate");
  render(<MemoryRouter><Page /></MemoryRouter>);

  fireEvent.change(screen.getByPlaceholderText(/one step per line/i), {
    target: { value: "cook the onion then simmer it for ages" },
  });
  fireEvent.click(screen.getByRole("button", { name: /tidy into steps/i }));
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(createRecipe).toHaveBeenCalled());

  // Under the bug this was the pre-Tidy line, because the ingredients write clobbered it.
  const draft = createRecipe.mock.calls[0][1];
  expect(draft.steps.map((s: { text: string }) => s.text)).toEqual([
    "Cook the onion until golden",
    "Simmer for twenty minutes",
  ]);
  // And the ingredients must still arrive: the fix must not trade one loss for the other.
  expect(draft.ingredients.map((i: { item: string }) => i.item)).toEqual(["onion"]);
  vi.doUnmock("../lib/api/extract");
  vi.doUnmock("../lib/api/recipes");
  vi.doUnmock("../lib/api/tags");
});

// Reporting is only worth having if it fires on the path where a failure costs someone their
// work. A save that blows up must leave a trace without anybody being asked to describe it.
test("a failed save reports itself once, with the context that says where", async () => {
  const reportError = vi.fn();
  vi.doMock("../lib/api/errorLog", () => ({ reportError }));
  vi.doMock("../lib/api/recipes", () => ({
    createRecipe: vi.fn().mockRejectedValue(new Error("db is on fire")),
    listFamilyIngredientNames: vi.fn().mockResolvedValue([]),
    listFamilySectionNames: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("../lib/api/tags", () => ({ setRecipeTags: vi.fn(), listTags: vi.fn().mockResolvedValue([]) }));

  vi.resetModules();
  const { default: Page } = await import("./RecipeCreate");
  render(<MemoryRouter><Page /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(reportError).toHaveBeenCalledWith("save:recipe-create", expect.any(Error)));
  expect(reportError).toHaveBeenCalledTimes(1);
  // The person still gets told; reporting is additional, never a replacement.
  expect(await screen.findByText(/db is on fire/i)).toBeInTheDocument();
  vi.doUnmock("../lib/api/errorLog");
  vi.doUnmock("../lib/api/recipes");
  vi.doUnmock("../lib/api/tags");
});
