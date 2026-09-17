import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookMode from "./CookMode";

vi.mock("../lib/api/recipes", () => ({
  getRecipe: vi.fn().mockResolvedValue({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [
      { position: 0, text: "mix well" },
      { position: 1, text: "bake it" },
    ],
    photos: [],
  }),
}));

test("advances through steps with the Next button", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1/cook"]}>
      <Routes>
        <Route path="/recipes/:id/cook" element={<CookMode />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("mix well")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});
