import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Cupboard from "./Cupboard";

const family = { active: { id: "f1", name: "F", invite_code: "x", created_by: "u" } as any };
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "olive oil", label: "Olive oil", kind: "keep", state: "low", expires_on: null },
  ]),
  addItem: vi.fn().mockResolvedValue({
    id: "p3", key: "salt", label: "Salt", kind: "keep", state: "have", expires_on: null,
  }),
  setState: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/api/recipes", () => ({
  listRecipeIngredientIndex: vi.fn().mockResolvedValue([]),
  listFamilyIngredientNames: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => vi.clearAllMocks());

function renderCupboard() {
  return render(<MemoryRouter><Cupboard /></MemoryRouter>);
}

test("lists what is in the cupboard with its state", async () => {
  renderCupboard();
  expect(await screen.findByText("Rice")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Olive oil.*low/i })).toBeInTheDocument();
});

test("tapping an item cycles have to low", async () => {
  const pantry = await import("../lib/api/pantry");
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /Rice.*have/i }));
  await waitFor(() => expect(pantry.setState).toHaveBeenCalledWith("p1", "low"));
});

test("adding an item stores it", async () => {
  const pantry = await import("../lib/api/pantry");
  renderCupboard();
  await screen.findByText("Rice");
  await userEvent.type(screen.getByLabelText("Add to the cupboard"), "Salt");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "Salt", "keep"));
});

test("offers a seed list when the cupboard is empty", async () => {
  const pantry = await import("../lib/api/pantry");
  const recipes = await import("../lib/api/recipes");
  (pantry.listPantry as any).mockResolvedValueOnce([]);
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([
    { recipe_id: "1", title: "A", items: ["Salt", "Rice"] },
  ]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: "Salt" }));
  await userEvent.click(screen.getByRole("button", { name: /Add 1 to the cupboard/ }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "Salt", "keep"));
});

// An empty vault has nothing to suggest from. Saying so beats an empty panel
// with a dead button.
test("says so when there is nothing to suggest", async () => {
  const pantry = await import("../lib/api/pantry");
  const recipes = await import("../lib/api/recipes");
  (pantry.listPantry as any).mockResolvedValueOnce([]);
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([]);
  renderCupboard();
  expect(await screen.findByText(/no recipes to suggest from/i)).toBeInTheDocument();
});

test("shows what you can cook, and what is missing", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([
    { recipe_id: "r1", title: "Rice bowl", items: ["Rice"] },
    { recipe_id: "r2", title: "Pilaf", items: ["Rice", "Cumin"] },
  ]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /What can I cook/i }));
  expect(await screen.findByText("Rice bowl")).toBeInTheDocument();
  expect(screen.getByText(/Missing Cumin/i)).toBeInTheDocument();
});

// An empty result must explain itself rather than render nothing at all.
test("explains an empty result", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /What can I cook/i }));
  expect(await screen.findByText(/No recipes in the vault yet/i)).toBeInTheDocument();
});
