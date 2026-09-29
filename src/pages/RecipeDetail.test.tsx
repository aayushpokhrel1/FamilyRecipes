import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import RecipeDetail from "./RecipeDetail";
import { listPlans } from "../lib/api/mealPlans";
import { getRecipe } from "../lib/api/recipes";
import { getByline } from "../lib/api/profile";

// The one recipe every test starts from. Extracted so a test can spread it and change only
// the field it is about, rather than restating twelve fields and drifting from the rest.
const baseRecipe = {
  id: "r1", family_id: "f1", author_id: "u", title: "Dal",
  story: "a tale", provenance: null, servings: 2, prep_minutes: null,
  cook_minutes: null, visibility: "family", source_url: null,
  created_at: "", updated_at: "",
  source_recipe_id: null, source_cook_name: null, adapted_at: null,
  removed_at: null, removed_reason: null,
};

vi.mock("../lib/api/recipes", () => ({
  getRecipe: vi.fn().mockResolvedValue({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: "a tale", provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
      source_recipe_id: null, source_cook_name: null, adapted_at: null,
      removed_at: null, removed_reason: null,
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [{ position: 0, text: "mix well" }],
    photos: [],
  }),
}));

const saveToVault = vi.fn().mockResolvedValue("new-id");
vi.mock("../lib/api/saves", () => ({
  saveToVault: (...a: any[]) => saveToVault(...a),
}));

const reportRecipe = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/api/moderation", () => ({
  reportRecipe: (...a: any[]) => reportRecipe(...a),
}));

// The active family is where a save lands, and its absence is what removes the button.
// Hoisted and stable so the object identity never changes between renders.
const family = vi.hoisted(() => ({
  active: { id: "f2", name: "Fam", invite_code: "x", created_by: "u", role: "owner" } as
    { id: string; name: string; invite_code: string; created_by: string;
      role: "owner" | "member" } | null,
  // The families the viewer belongs to, WITH their role. Edit and Delete are offered to the
  // author or a family owner, which is exactly what recipes_update and recipes_delete allow.
  mine: [] as { id: string; name: string; invite_code: string; created_by: string;
    role: "owner" | "member" }[],
}));
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active, families: family.mine }),
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
  family.mine = [];
  reportRecipe.mockClear();
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
  // "u" is baseRecipe's author_id. This previously said "u1", so the viewer was NOT the
  // owner and the test asserted owner controls for someone who had none: it passed only
  // because the controls rendered for every signed-in viewer, which was the bug. The
  // visitor case is covered by the test above.
  mockAuth = { userId: "u", loading: false };
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
      source_recipe_id: null, source_cook_name: null, adapted_at: null,
      removed_at: null, removed_reason: null,
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

// Lineage is a fact and cannot be cleared, but a recipe you have rewritten should read as
// yours, so the header shrinks to a note after the first edit.
test("an untouched copy says where it came from, in the header", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, source_recipe_id: "src-1", source_cook_name: "Mei",
              adapted_at: null },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/saved from Mei's kitchen/i)).toBeInTheDocument();
});

test("an adapted copy keeps the credit but only as a quiet note", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, source_recipe_id: "src-1", source_cook_name: "Mei",
              adapted_at: "2026-09-28T00:00:00Z" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/from Mei/i)).toBeInTheDocument();
  expect(screen.queryByText(/saved from Mei's kitchen/i)).not.toBeInTheDocument();
});

test("a recipe that is nobody's copy shows no credit line", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByText(/from /i)).not.toBeInTheDocument();
});

// Reporting is the gate on Potluck opening to strangers, and it is only offered on someone
// else's published recipe: the same condition the Save button uses.
test("a public recipe that is not yours shows a Report control", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, visibility: "public" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("button", { name: "Report" })).toBeInTheDocument();
});

test("your own recipe shows no Report control", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, visibility: "public", family_id: "f2" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
});

test("choosing a reason and submitting reports the recipe", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, visibility: "public" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Report" }));
  await user.selectOptions(screen.getByLabelText("reason"), "offensive");
  await user.type(screen.getByLabelText("note"), "rude");
  await user.click(screen.getByRole("button", { name: /submit report/i }));
  expect(reportRecipe).toHaveBeenCalledWith("r1", "offensive", "rude");
});

test("once reported the control reads Reported and is disabled", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, visibility: "public" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Report" }));
  await user.click(screen.getByRole("button", { name: /submit report/i }));
  const done = await screen.findByRole("button", { name: "Reported" });
  expect(done).toBeDisabled();
});

// Silent removal is the thing people find most unfair, so the author is told why.
test("a removed recipe shows the banner and its reason", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, visibility: "family", removed_at: "2026-09-28T00:00:00Z",
              removed_reason: "offensive" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/removed from potluck/i)).toBeInTheDocument();
  expect(screen.getByText(/Offensive/)).toBeInTheDocument();
});

test("a recipe that was never removed shows no banner", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByText(/removed from potluck/i)).not.toBeInTheDocument();
});

// Edit and Delete used to render for ANY signed-in viewer, so a stranger reading a published
// recipe was offered controls the database would refuse. RLS was never the hole; the UI was
// simply lying about what it would let you do.
test("a signed-in stranger is not offered Edit or Delete on someone else's recipe", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

test("the author is offered Edit and Delete", async () => {
  mockAuth = { userId: "u", loading: false };   // baseRecipe's author_id
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});

// An owner of the recipe's family may edit it even without having written it, because
// recipes_update allows exactly that. Hiding it from them would be the opposite bug.
test("an owner of the recipe's family is offered Edit and Delete", async () => {
  family.mine = [{ id: "f1", name: "Theirs", invite_code: "x", created_by: "u",
                   role: "owner" }];
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
});

// A plain member is not an owner, and recipes_update would refuse them.
test("a non-owner member of the recipe's family is not offered Edit", async () => {
  family.mine = [{ id: "f1", name: "Theirs", invite_code: "x", created_by: "u",
                   role: "member" }];
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
});
