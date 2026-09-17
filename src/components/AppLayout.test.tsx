import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import AppLayout from "./AppLayout";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    families: [],
    activeFamily: null,
    setActiveFamily() {},
    reload() {},
  }),
}));
vi.mock("../lib/api/auth", () => ({ signOut: vi.fn() }));

test("renders the app shell", () => {
  render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /families/i })).toBeInTheDocument();
});
