import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Potluck from "./Potluck";

vi.mock("../lib/api/recipes", () => ({
  listPublicRecipes: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/api/profile", () => ({
  getBylines: vi.fn().mockResolvedValue(new Map()),
  getMyProfile: vi.fn().mockResolvedValue({ id: "u1", is_moderator: false }),
}));
vi.mock("../lib/api/follows", () => ({
  listFollowedCookIds: vi.fn().mockResolvedValue([]),
}));

const saveToVault = vi.fn().mockResolvedValue("new-id");
const listSavedSourceIds = vi.fn().mockResolvedValue(new Set<string>());
vi.mock("../lib/api/saves", () => ({
  saveToVault: (...a: any[]) => saveToVault(...a),
  listSavedSourceIds: (...a: any[]) => listSavedSourceIds(...a),
}));

// The active family is what a save lands in, and its absence is what removes the button.
// Hoisted and stable: the recipes effect depends on activeFamily, so a fresh object on every
// render would re-run that effect forever.
const family = vi.hoisted(() => ({
  active: { id: "f1", name: "Fam", invite_code: "x", created_by: "u" } as
    { id: string; name: string; invite_code: string; created_by: string } | null,
}));
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

beforeEach(() => vi.clearAllMocks());

// Potluck shows other households' recipes, so the default fixture belongs to f2, NOT to the
// active family f1. A recipe from your own family is the case that must show no button, and
// it has its own test below.
function recipe(id: string, title: string, familyId = "f2") {
  return {
    id,
    family_id: familyId,
    author_id: "a1",
    title,
    story: null,
    provenance: null,
    servings: null,
    prep_minutes: null,
    cook_minutes: null,
    visibility: "public" as const,
    source_url: null,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  };
}

function renderPotluck() {
  return render(
    <MemoryRouter>
      <Potluck />
    </MemoryRouter>,
  );
}

test("renders returned recipes with their bylines", async () => {
  const recipes = await import("../lib/api/recipes");
  const profile = await import("../lib/api/profile");
  (recipes.listPublicRecipes as any).mockResolvedValueOnce([
    recipe("r1", "Dal"),
    recipe("r2", "Pilaf"),
  ]);
  (profile.getBylines as any).mockResolvedValueOnce(
    new Map([
      ["r1", { handle: "a", public_name: "Asha", family_name: "Rao" }],
      ["r2", { handle: "b", public_name: null, family_name: "Iyer" }],
    ]),
  );

  renderPotluck();

  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(screen.getByText("Pilaf")).toBeInTheDocument();
  expect(screen.getByText(/Asha/)).toBeInTheDocument();
  expect(screen.getByText(/A cook/)).toBeInTheDocument();
});

test("switching to Following when listFollowedCookIds resolves to [] renders the empty note and no recipes", async () => {
  const recipes = await import("../lib/api/recipes");
  const follows = await import("../lib/api/follows");
  (recipes.listPublicRecipes as any).mockResolvedValue([recipe("r1", "Dal")]);
  (follows.listFollowedCookIds as any).mockResolvedValueOnce([]);

  renderPotluck();
  await screen.findByText("Dal");

  await userEvent.click(screen.getByRole("button", { name: "Following" }));

  expect(await screen.findByText("You are not following any cooks yet.")).toBeInTheDocument();
  expect(screen.queryByText("Dal")).not.toBeInTheDocument();
});

test("submitting a search calls listPublicRecipes with that search term", async () => {
  const recipes = await import("../lib/api/recipes");
  // Set explicitly: mockResolvedValue from an earlier test persists across tests, so without
  // this the list is still the previous test's recipe and the empty state never renders.
  (recipes.listPublicRecipes as any).mockResolvedValue([]);
  renderPotluck();
  await screen.findByText("No public recipes yet.");

  await userEvent.type(screen.getByLabelText("search potluck"), "dal");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() =>
    expect(recipes.listPublicRecipes).toHaveBeenCalledWith(
      expect.objectContaining({ search: "dal" }),
    ),
  );
});

test("Show more is absent when fewer than 24 recipes come back", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listPublicRecipes as any).mockResolvedValueOnce([recipe("r1", "Dal")]);

  renderPotluck();
  await screen.findByText("Dal");

  expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
});

// One call for the page, never one per card. The byline rule above exists for the same
// reason and is pinned the same way; a per-card query is an N+1 that only shows up in
// production, where a feed has more than two cards.
test("asks once for which recipes are already saved, not once per card", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listPublicRecipes as any).mockResolvedValueOnce([
    recipe("r1", "Dal"),
    recipe("r2", "Pilaf"),
  ]);
  renderPotluck();
  await screen.findByText("Dal");
  expect(listSavedSourceIds).toHaveBeenCalledTimes(1);
});

test("saving a card marks it as in your vault without a reload", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listPublicRecipes as any).mockResolvedValueOnce([recipe("r1", "Dal")]);
  renderPotluck();
  const btn = await screen.findByRole("button", { name: /save dal to my vault/i });
  await userEvent.click(btn);
  expect(saveToVault).toHaveBeenCalledWith("r1", "f1");
  expect(await screen.findByRole("button", { name: /is in your vault/i })).toBeDisabled();
});

// The browser caught this one and the tests did not: Potluck shows everything published,
// "yours included", so your own household's recipes appear in the grid with a Save button
// that would copy a recipe you already own into the vault it already lives in.
test("a recipe from your own family has no save button", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listPublicRecipes as any).mockResolvedValue([recipe("mine", "My Own Dal", "f1")]);
  render(<MemoryRouter><Potluck /></MemoryRouter>);
  await screen.findByText("My Own Dal");
  expect(screen.queryByRole("button", { name: /save my own dal/i })).not.toBeInTheDocument();
});

test("explains the gap to a cook whose public name was cleared", async () => {
  const recipes = await import("../lib/api/recipes");
  const profile = await import("../lib/api/profile");
  (recipes.listPublicRecipes as any).mockResolvedValue([]);
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1",
    is_moderator: false,
    name_cleared_at: "2026-10-02T00:00:00Z",
    public_name: null,
  });

  renderPotluck();

  expect(await screen.findByText(/not shown here while your public name is cleared/))
    .toBeInTheDocument();
});

test("says nothing to an ordinary cook", async () => {
  const recipes = await import("../lib/api/recipes");
  const profile = await import("../lib/api/profile");
  (recipes.listPublicRecipes as any).mockResolvedValue([]);
  // Set explicitly: mockResolvedValue from the cleared-cook test above persists across
  // tests, so without this the profile is still the cleared one.
  (profile.getMyProfile as any).mockResolvedValue({ id: "u1", is_moderator: false });

  renderPotluck();
  await screen.findByText("No public recipes yet.");

  expect(screen.queryByText(/not shown here while your public name is cleared/))
    .not.toBeInTheDocument();
});
