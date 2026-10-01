import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import Drafts from "./Drafts";

const listDrafts = vi.fn();
const deleteDraft = vi.fn();

vi.mock("../lib/api/drafts", () => ({
  listDrafts: () => listDrafts(),
  deleteDraft: (id: string) => deleteDraft(id),
}));

vi.mock("../lib/api/errorLog", () => ({ reportError: vi.fn() }));

function savedDraft(id: string, title: string) {
  return {
    id,
    author_id: "u1",
    target_family_id: "f1",
    target_recipe_id: null,
    draft: {
      title,
      story: "",
      provenance: "",
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      ingredients: [],
      steps: [],
      source_url: null,
    },
    visibility: "private" as const,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    base_updated_at: null,
  };
}

test("lists every draft with its title", async () => {
  listDrafts.mockResolvedValue([savedDraft("d1", "Sunday sauce"), savedDraft("d2", "Sourdough")]);
  render(
    <MemoryRouter>
      <Drafts />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Sunday sauce")).toBeInTheDocument();
  expect(screen.getByText("Sourdough")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /resume/i })).toHaveLength(2);
});

test("says plainly when there are no drafts", async () => {
  listDrafts.mockResolvedValue([]);
  render(
    <MemoryRouter>
      <Drafts />
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByText(/no drafts yet/i)).toBeInTheDocument());
});

// An edit draft is a change to a recipe that already exists, so it must not read like a new
// recipe and must not resume into the create form. Resuming into /recipes/new would silently
// turn the edit into a second copy of the recipe.
test("an edit draft reads Editing and resumes into the edit page", async () => {
  listDrafts.mockResolvedValue([
    { ...savedDraft("d1", "Sel roti"), target_recipe_id: "r9", base_updated_at: "2024-01-01T00:00:00.000Z" },
  ]);
  render(
    <MemoryRouter>
      <Drafts />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Editing Sel roti")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /resume/i })).toHaveAttribute(
    "href",
    "/recipes/r9/edit?draft=d1",
  );
});
