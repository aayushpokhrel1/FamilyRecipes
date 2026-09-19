import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import MyKitchen from "./MyKitchen";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn(), renamePlan: vi.fn(), deletePlan: vi.fn(), setShared: vi.fn(),
}));

test("renders the My Kitchen heading and a create control", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: /my kitchen/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new plan/i })).toBeInTheDocument();
});
