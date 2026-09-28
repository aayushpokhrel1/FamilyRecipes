import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookPage from "./CookPage";
import { getPublicCook } from "../lib/api/profile";
import { listPublicRecipesByAuthor } from "../lib/api/recipes";
import { follow, isFollowing, unfollow } from "../lib/api/follows";
import type { Recipe } from "../lib/api/types";

vi.mock("../lib/api/profile", () => ({ getPublicCook: vi.fn() }));
vi.mock("../lib/api/recipes", () => ({ listPublicRecipesByAuthor: vi.fn() }));
vi.mock("../lib/api/follows", () => ({
  isFollowing: vi.fn().mockResolvedValue(false), follow: vi.fn(), unfollow: vi.fn(),
}));
// Defaults to SIGNED OUT so the three tests written before the follow button are unaffected.
let mockAuth: { userId: string | null; loading: boolean } = { userId: null, loading: false };
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));

function renderCook() {
  render(
    <MemoryRouter initialEntries={["/cooks/aayush"]}>
      <Routes>
        <Route path="/cooks/:handle" element={<CookPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("shows a cook and their published recipes", async () => {
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: "Cooks momo.", avatar_url: "c1/a.png",
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([
    { id: "r1", title: "Momo" } as Recipe,
  ]);
  renderCook();
  expect(await screen.findByText("Aayush")).toBeInTheDocument();
  expect(screen.getByText("Cooks momo.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Momo" })).toHaveAttribute("href", "/recipes/r1");
});

test("says not found for an unknown or unpublished handle", async () => {
  vi.mocked(getPublicCook).mockResolvedValue(null);
  renderCook();
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  // An unknown handle and an unpublished cook must read identically.
  expect(screen.queryByText(/unpublished|private/i)).not.toBeInTheDocument();
});

test("still shows the cook when the recipe list fails", async () => {
  // A transient failure loading someone's recipes must not render "Cook not found.", which
  // would deny that a cook who plainly exists exists.
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockRejectedValue(new Error("network"));
  renderCook();
  expect(await screen.findByText("Aayush")).toBeInTheDocument();
  expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  expect(screen.getByText(/no published recipes yet/i)).toBeInTheDocument();
});

test("shows no follow button to a visitor", async () => {
  mockAuth = { userId: null, loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  renderCook();
  await screen.findByText("Aayush");
  expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();
});

test("shows no follow button on your own page", async () => {
  // Following yourself is refused by a check constraint, so the button could only ever fail.
  mockAuth = { userId: "c1", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  renderCook();
  await screen.findByText("Aayush");
  expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();
});

test("follows another cook and flips to Following", async () => {
  mockAuth = { userId: "me", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  vi.mocked(isFollowing).mockResolvedValue(false);
  renderCook();
  const btn = await screen.findByRole("button", { name: "Follow" });
  fireEvent.click(btn);
  await waitFor(() => expect(follow).toHaveBeenCalledWith("c1"));
  expect(await screen.findByRole("button", { name: "Following" })).toBeInTheDocument();
});

test("unfollows when already following", async () => {
  mockAuth = { userId: "me", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  vi.mocked(isFollowing).mockResolvedValue(true);
  renderCook();
  fireEvent.click(await screen.findByRole("button", { name: "Following" }));
  await waitFor(() => expect(unfollow).toHaveBeenCalledWith("c1"));
});
