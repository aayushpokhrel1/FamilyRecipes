import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, vi } from "vitest";
import FamilyDataPanel from "./FamilyDataPanel";

// A vi.fn(), not a plain arrow: the no-family test swaps the return value, and a
// plain function has no mockReturnValue to swap.
vi.mock("../context/FamilyContext", () => ({
  useFamily: vi.fn(() => ({
    activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" },
  })),
}));
vi.mock("../lib/api/ingredientCategories", () => ({
  listCategoryOverrides: vi.fn().mockResolvedValue(new Map()),
  setCategoryOverride: vi.fn(), removeCategoryOverride: vi.fn(),
}));
vi.mock("../lib/api/recipes", () => ({
  listFamilySectionNames: vi.fn().mockResolvedValue([]),
}));

const FAMILY = { id: "f1", name: "F", invite_code: "x", created_by: "u" };

// The panel now links to the cupboard, so it needs a router around it.
function renderPanel() {
  return render(<MemoryRouter><FamilyDataPanel /></MemoryRouter>);
}

// Each test starts with a family again: the no-family test below swaps the return
// value, and without this reset that null leaks into every test after it.
beforeEach(async () => {
  const { useFamily } = await import("../context/FamilyContext");
  (useFamily as any).mockReturnValue({ activeFamily: FAMILY });
});

test("with no active family it asks you to join one and calls nothing", async () => {
  const { useFamily } = await import("../context/FamilyContext");
  (useFamily as any).mockReturnValue({ activeFamily: null });
  const cats = await import("../lib/api/ingredientCategories");
  const recipes = await import("../lib/api/recipes");

  renderPanel();

  expect(screen.getByText("Join a family to manage its shopping data.")).toBeInTheDocument();
  expect(cats.listCategoryOverrides).not.toHaveBeenCalled();
  expect(recipes.listFamilySectionNames).not.toHaveBeenCalled();
});

test("an aisle tag shows its key and Remove untags it", async () => {
  const cats = await import("../lib/api/ingredientCategories");
  (cats.listCategoryOverrides as any).mockResolvedValue(new Map([["besan", "Baking"]]));

  renderPanel();

  expect(await screen.findByText("besan")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(cats.removeCategoryOverride).toHaveBeenCalledWith("f1", "besan"));
});

// The staples editor deliberately moved to /kitchen/cupboard, so Settings links
// there rather than offering a second place to change the same thing.
test("points at the cupboard instead of editing it", async () => {
  renderPanel();

  expect(await screen.findByRole("heading", { name: "The cupboard" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "the cupboard" }))
    .toHaveAttribute("href", "/kitchen/cupboard");
  expect(screen.queryByPlaceholderText("Add a staple")).not.toBeInTheDocument();
});
