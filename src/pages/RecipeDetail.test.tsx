import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import RecipeDetail from "./RecipeDetail";

vi.mock("../lib/api/recipes", () => ({
  getRecipe: vi.fn().mockResolvedValue({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: "a tale", provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [{ position: 0, text: "mix well" }],
    photos: [],
  }),
}));

vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([
    { id: "p1", owner_id: "u", family_id: "f1", name: "This week", view_mode: "list",
      is_shared: false, checked_items: [], created_at: "", updated_at: "" },
  ]),
  addRecipe: vi.fn(),
}));

vi.mock("../lib/api/photos", () => ({
  getCoverPhotoUrl: vi.fn().mockResolvedValue(null),
}));
const listRecipeTags = vi.fn().mockResolvedValue([]);
vi.mock("../lib/api/tags", () => ({ listRecipeTags: (...a: any[]) => listRecipeTags(...a) }));

test("renders the recipe title, ingredients and steps", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(await screen.findByText("flour")).toBeInTheDocument();
  expect(await screen.findByText("mix well")).toBeInTheDocument();
});

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

// Tags were write-only: you could tag a recipe and filter the vault by tag, but the recipe
// itself never showed them, so tagging read as doing nothing at all. Same shape as the photos
// bug: the data was fine, nothing showed it back.
test("the recipe shows the tags it carries", async () => {
  listRecipeTags.mockResolvedValue([
    { id: "t1", family_id: "f1", name: "vegetarian" },
    { id: "t2", family_id: "f1", name: "quick" },
  ]);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("vegetarian")).toBeInTheDocument();
  expect(screen.getByText("quick")).toBeInTheDocument();
});

// A tag read failing must not cost you the recipe.
test("a recipe with no tags renders normally", async () => {
  listRecipeTags.mockRejectedValue(new Error("nope"));
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("Dal")).toBeInTheDocument();
});
