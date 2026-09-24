import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookMode from "./CookMode";

const family = vi.hoisted(() => ({
  active: { id: "f1", name: "F", invite_code: "x", created_by: "u" } as
    { id: string; name: string; invite_code: string; created_by: string } | null,
}));

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

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

vi.mock("../lib/api/cookLog", () => ({
  logCooked: vi.fn().mockResolvedValue({}),
}));

function renderCookMode() {
  render(
    <MemoryRouter initialEntries={["/recipes/r1/cook"]}>
      <Routes>
        <Route path="/recipes/:id/cook" element={<CookMode />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("advances through steps with the Next button", async () => {
  renderCookMode();
  expect(await screen.findByText("mix well")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("marking as cooked logs once and is not offered again", async () => {
  const cl = await import("../lib/api/cookLog");
  renderCookMode();
  const button = await screen.findByRole("button", { name: /mark as cooked/i });
  await userEvent.click(button);
  expect(cl.logCooked).toHaveBeenCalledWith("f1", "r1");
  expect(await screen.findByRole("status")).toHaveTextContent("Logged. Nice one.");
  expect(screen.queryByRole("button", { name: /mark as cooked/i })).not.toBeInTheDocument();
});

test("marking as cooked is disabled without an active family", async () => {
  family.active = null;
  renderCookMode();
  expect(await screen.findByRole("button", { name: /mark as cooked/i })).toBeDisabled();
  family.active = { id: "f1", name: "F", invite_code: "x", created_by: "u" };
});
