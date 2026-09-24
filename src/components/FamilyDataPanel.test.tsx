import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../lib/api/staples", () => ({
  listStaples: vi.fn().mockResolvedValue([]),
  addStaple: vi.fn(), removeStaple: vi.fn(),
}));
vi.mock("../lib/api/recipes", () => ({
  listFamilySectionNames: vi.fn().mockResolvedValue([]),
}));

const FAMILY = { id: "f1", name: "F", invite_code: "x", created_by: "u" };

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
  const staples = await import("../lib/api/staples");
  const recipes = await import("../lib/api/recipes");

  render(<FamilyDataPanel />);

  expect(screen.getByText("Join a family to manage its shopping data.")).toBeInTheDocument();
  expect(cats.listCategoryOverrides).not.toHaveBeenCalled();
  expect(staples.listStaples).not.toHaveBeenCalled();
  expect(recipes.listFamilySectionNames).not.toHaveBeenCalled();
});

test("an aisle tag shows its key and Remove untags it", async () => {
  const cats = await import("../lib/api/ingredientCategories");
  (cats.listCategoryOverrides as any).mockResolvedValue(new Map([["besan", "Baking"]]));

  render(<FamilyDataPanel />);

  expect(await screen.findByText("besan")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(cats.removeCategoryOverride).toHaveBeenCalledWith("f1", "besan"));
});

test("adding a staple trims the label, and an empty input calls nothing", async () => {
  const staples = await import("../lib/api/staples");
  (staples.addStaple as any).mockResolvedValue({ id: "s1", key: "salt", label: "salt" });

  render(<FamilyDataPanel />);
  const input = await screen.findByPlaceholderText("Add a staple");

  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(staples.addStaple).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "  salt  " } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(staples.addStaple).toHaveBeenCalledWith("f1", "salt"));
});
