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

vi.mock("../lib/api/photos", () => ({
  listCoverPhotoUrls: vi.fn().mockResolvedValue(new Map()),
}));

// Resolves to [] by default, because the real listDrafts always returns a promise and a
// mock that does not is a fixture bug wearing a component bug's clothes.
vi.mock("../lib/api/drafts", () => ({ listDrafts: vi.fn().mockResolvedValue([]) }));
import { listDrafts } from "../lib/api/drafts";

test("lists recipes for the active family", async () => {
  render(
    <MemoryRouter>
      <RecipeList />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(await screen.findByText("Rice")).toBeInTheDocument();
});

// One draft is the ordinary case, and the first browser pass showed "1 unfinished drafts".
// A count in a sentence needs the singular written down somewhere that fails.
test("counts a single draft in the singular", async () => {
  vi.mocked(listDrafts).mockResolvedValue([{ id: "d1" }] as never);
  render(
    <MemoryRouter>
      <RecipeList />
    </MemoryRouter>,
  );
  expect(await screen.findByText("1 unfinished draft")).toBeInTheDocument();
});

test("counts several drafts in the plural", async () => {
  vi.mocked(listDrafts).mockResolvedValue([{ id: "d1" }, { id: "d2" }] as never);
  render(
    <MemoryRouter>
      <RecipeList />
    </MemoryRouter>,
  );
  expect(await screen.findByText("2 unfinished drafts")).toBeInTheDocument();
});
