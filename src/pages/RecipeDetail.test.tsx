import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import RecipeDetail from "./RecipeDetail";
import { listPlans } from "../lib/api/mealPlans";
import { getRecipe } from "../lib/api/recipes";
import { getByline } from "../lib/api/profile";

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

vi.mock("../lib/api/profile", () => ({ getByline: vi.fn().mockResolvedValue(null) }));

// Hoisted by vi.mock, so mockAuth is read at render time, not at mock time. The existing
// tests below are the signed-in case; only the visitor tests reassign it.
let mockAuth: { userId: string | null; loading: boolean } = { userId: "u1", loading: false };
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));

// Reset between tests so a visitor test cannot leak into the next one.
beforeEach(() => {
  mockAuth = { userId: "u1", loading: false };
});

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

test("shows a visitor the recipe and the byline, and none of the owner controls", async () => {
  mockAuth = { userId: null, loading: false };
  vi.mocked(getByline).mockResolvedValue({
    handle: "aayush", public_name: "Aayush", family_name: "Pokhrel",
  });
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(screen.getByText(/Aayush/)).toBeInTheDocument();
  expect(screen.getByText(/Pokhrel/)).toBeInTheDocument();
  // Every one of these would bounce a visitor to /signin, so none may render.
  expect(screen.queryByRole("link", { name: /cook mode/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add to plan/i })).not.toBeInTheDocument();
  // Comments are gone by RLS, but the section must not render an empty shell either.
  expect(screen.queryByText(/comments/i)).not.toBeInTheDocument();
  // The visibility chip is meaningless to a stranger.
  expect(screen.queryByText("public")).not.toBeInTheDocument();
});

test("does not ask for plans when there is no session", async () => {
  mockAuth = { userId: null, loading: false };
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(listPlans).not.toHaveBeenCalled();
});

test("still shows the owner controls when signed in", async () => {
  mockAuth = { userId: "u1", loading: false };
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("link", { name: /cook mode/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
});

test("a visitor's byline links to the cook page", async () => {
  mockAuth = { userId: null, loading: false };
  vi.mocked(getByline).mockResolvedValue({
    handle: "aayush", public_name: "Aayush", family_name: "Pokhrel",
  });
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("link", { name: "Aayush" }))
    .toHaveAttribute("href", "/cooks/aayush");
});

test("a byline with no handle stays plain text, not a link to /cooks/null", async () => {
  // public_recipe_bylines left-joins the profile, so a recipe published by a cook who never
  // claimed a handle has a null one and must still render.
  mockAuth = { userId: null, loading: false };
  vi.mocked(getByline).mockResolvedValue({
    handle: null, public_name: null, family_name: "Pokhrel",
  });
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/A cook/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /A cook/ })).not.toBeInTheDocument();
});

// Extraction sometimes writes the amount into the item field, and the quantity column
// right beside it already says the amount. The only recipe ever published read
// "(1.5 kg) boneless pork ribs" to every stranger who opened it.
test("an ingredient whose item carries a leaked quantity reads without it", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Ribs",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "public", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1.5", unit: "kg", item: "(1.5 kg) boneless pork ribs" }],
    steps: [{ position: 0, text: "cook" }],
    photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("boneless pork ribs")).toBeInTheDocument();
  expect(screen.queryByText("(1.5 kg) boneless pork ribs")).not.toBeInTheDocument();
});
