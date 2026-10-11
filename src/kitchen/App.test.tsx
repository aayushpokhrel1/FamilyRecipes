import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import KitchenApp from "./App";
import { signOut } from "../lib/api/auth";

vi.mock("../lib/api/auth", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
const auth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth() }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({ userId: "u1", loading: false });
});

describe("the kitchen shell", () => {
  it("lets a signed-in person sign out, which plan 2 shipped without", async () => {
    render(
      <MemoryRouter>
        <KitchenApp />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it("offers no sign-out to somebody who is not signed in", () => {
    auth.mockReturnValue({ userId: null, loading: false });
    render(
      <MemoryRouter>
        <KitchenApp />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("does NOT clear the family app's photo cache, which is not its business", async () => {
    // The seal: this app must not reach a family module, and signOut is family-free since
    // 2026-10-11. If a future change imports forgetPhotoUrls here, kitchen_seal.test.ts fails.
    render(
      <MemoryRouter>
        <KitchenApp />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
