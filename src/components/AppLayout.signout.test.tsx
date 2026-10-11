import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AppLayout from "./AppLayout";

// The photo-url cache clear used to live inside signOut, which made the shared auth module
// import a family data module and so unusable from the sealed kitchen app. It moved OUT to
// this call site, and this test is the only thing keeping it from being lost: a remembered
// signed url outlives the session by up to a day, so the next person to sign in on a shared
// computer would be served the previous person's photos.
vi.mock("../lib/api/auth", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/api/photos", () => ({ forgetPhotoUrls: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ userId: "u1", loading: false }) }));
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ families: [], activeFamily: null, setActiveFamily() {}, reload() {} }),
}));
vi.mock("./FamilySwitcher", () => ({ default: () => <div>switcher</div> }));

import { signOut } from "../lib/api/auth";
import { forgetPhotoUrls } from "../lib/api/photos";

beforeEach(() => vi.clearAllMocks());

describe("signing out of the family app", () => {
  it("forgets the remembered photo urls", async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
    expect(forgetPhotoUrls).toHaveBeenCalled();
  });
});
