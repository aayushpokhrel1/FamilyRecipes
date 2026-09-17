import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import RecipeCreate from "./RecipeCreate";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" },
  }),
}));

test("renders the guided create form", () => {
  render(
    <MemoryRouter>
      <RecipeCreate />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: /add ingredient/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument();
});
