import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import RecipeList from "./RecipeList";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    activeFamily: { id: "f1", name: "Fam", invite_code: "x", created_by: "u" },
    families: [],
    setActiveFamily() {},
    reload() {},
  }),
}));

vi.mock("../lib/api/recipes", () => ({
  listRecipes: vi.fn().mockResolvedValue([
    {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: null, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    {
      id: "r2", family_id: "f1", author_id: "u", title: "Rice",
      story: null, provenance: null, servings: null, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
  ]),
}));

test("lists recipes for the active family", async () => {
  render(
    <MemoryRouter>
      <RecipeList />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(await screen.findByText("Rice")).toBeInTheDocument();
});
