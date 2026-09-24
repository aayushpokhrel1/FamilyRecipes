import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookMode from "./CookMode";

const family = vi.hoisted(() => ({
  active: { id: "f1", name: "F", invite_code: "x", created_by: "u" } as
    { id: string; name: string; invite_code: string; created_by: string } | null,
}));

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

vi.mock("../lib/api/recipes", () => ({
  getRecipe: vi.fn().mockResolvedValue({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [
      { position: 0, text: "mix well" },
      { position: 1, text: "bake it" },
    ],
    photos: [],
  }),
}));

vi.mock("../lib/api/cookLog", () => ({
  logCooked: vi.fn().mockResolvedValue({}),
}));

vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([]),
  setState: vi.fn().mockResolvedValue(undefined),
}));

function renderCookMode() {
  render(
    <MemoryRouter initialEntries={["/recipes/r1/cook"]}>
      <Routes>
        <Route path="/recipes/:id/cook" element={<CookMode />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("advances through steps with the Next button", async () => {
  renderCookMode();
  expect(await screen.findByText("mix well")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("marking as cooked logs once and is not offered again", async () => {
  const cl = await import("../lib/api/cookLog");
  renderCookMode();
  const button = await screen.findByRole("button", { name: /mark as cooked/i });
  await userEvent.click(button);
  expect(cl.logCooked).toHaveBeenCalledWith("f1", "r1");
  expect(await screen.findByRole("status")).toHaveTextContent("Logged. Nice one.");
  expect(screen.queryByRole("button", { name: /mark as cooked/i })).not.toBeInTheDocument();
});

test("marking as cooked is disabled without an active family", async () => {
  family.active = null;
  renderCookMode();
  expect(await screen.findByRole("button", { name: /mark as cooked/i })).toBeDisabled();
  family.active = { id: "f1", name: "F", invite_code: "x", created_by: "u" };
});

// A family recipe is often just an ingredient list with no method written down.
// Mark as cooked used to live inside the steps block, so for those recipes the
// cook log was unreachable: the button simply did not exist. Found in the
// browser, not here, because every fixture above happens to have steps.
test("offers Mark as cooked even when the recipe has no steps", async () => {
  const recipes = await import("../lib/api/recipes");
  const base = await (recipes.getRecipe as any).mock.results[0]?.value;
  (recipes.getRecipe as any).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: base?.ingredients ?? [],
    steps: [],
    photos: [],
  });
  renderCookMode();
  expect(await screen.findByText("No steps yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as cooked" })).toBeInTheDocument();
});

test("after marking cooked, offers only the cupboard items that recipe used", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "saffron", label: "Saffron", kind: "keep", state: "have", expires_on: null },
  ]);
  const recipes = await import("../lib/api/recipes");
  (recipes.getRecipe as any).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "Rice" }],
    steps: [{ position: 0, text: "mix well" }],
    photos: [],
  });
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByRole("button", { name: /Rice.*out/i })).toBeInTheDocument();
  // Saffron is in the cupboard but not in this recipe, so it is not offered.
  expect(screen.queryByRole("button", { name: /Saffron/i })).not.toBeInTheDocument();
});

// A recipe whose ingredients are all unknown to the cupboard must not render
// an empty prompt with nothing in it.
test("skips the prompt when the recipe used nothing in the cupboard", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([]);
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByText(/Logged/i)).toBeInTheDocument();
  expect(screen.queryByText(/Used anything up/i)).not.toBeInTheDocument();
});
