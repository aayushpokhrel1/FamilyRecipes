import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookPage from "./CookPage";
import { getPublicCook } from "../lib/api/profile";
import { listPublicRecipesByAuthor } from "../lib/api/recipes";
import { follow, isFollowing, unfollow } from "../lib/api/follows";
import { listMyBlocks, removeBlock, setBlock } from "../lib/api/blocks";
import { reportCook } from "../lib/api/moderation";
import type { Recipe } from "../lib/api/types";

vi.mock("../lib/api/profile", () => ({ getPublicCook: vi.fn() }));
vi.mock("../lib/api/recipes", () => ({ listPublicRecipesByAuthor: vi.fn() }));
vi.mock("../lib/api/follows", () => ({
  isFollowing: vi.fn().mockResolvedValue(false), follow: vi.fn(), unfollow: vi.fn(),
}));
vi.mock("../lib/api/blocks", () => ({
  listMyBlocks: vi.fn().mockResolvedValue([]), setBlock: vi.fn(), removeBlock: vi.fn(),
}));
vi.mock("../lib/api/moderation", () => ({ reportCook: vi.fn() }));
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

// The three controls follow the Follow button's rule exactly: signed in, and never your own
// page. Mute, block and report of yourself are all things the database refuses.
async function renderOtherCook() {
  mockAuth = { userId: "me", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  vi.mocked(listMyBlocks).mockResolvedValue([]);
  renderCook();
  await screen.findByText("Aayush");
}

test("offers none of Mute, Block or Report on your own page", async () => {
  mockAuth = { userId: "c1", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  renderCook();
  await screen.findByText("Aayush");
  expect(screen.queryByRole("button", { name: "Mute" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
});

test("offers Mute, Block and Report on another cook's page", async () => {
  await renderOtherCook();
  expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Block" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
});

test("muting calls setBlock with mute and the control reads Muted", async () => {
  await renderOtherCook();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  await waitFor(() => expect(setBlock).toHaveBeenCalledWith("c1", "mute"));
  expect(await screen.findByRole("button", { name: "Muted" })).toBeInTheDocument();
});

test("blocking calls setBlock with block and the control reads Blocked", async () => {
  await renderOtherCook();
  fireEvent.click(screen.getByRole("button", { name: "Block" }));
  await waitFor(() => expect(setBlock).toHaveBeenCalledWith("c1", "block"));
  expect(await screen.findByRole("button", { name: "Blocked" })).toBeInTheDocument();
});

// A block you cannot lift from the page you set it on is a trap.
test("clicking an existing block lifts it", async () => {
  mockAuth = { userId: "me", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  vi.mocked(listMyBlocks).mockResolvedValue([
    { blocker_id: "me", blocked_id: "c1", kind: "block", created_at: "2026-09-29T00:00:00Z" },
  ]);
  renderCook();
  fireEvent.click(await screen.findByRole("button", { name: "Blocked" }));
  await waitFor(() => expect(removeBlock).toHaveBeenCalledWith("c1"));
  expect(await screen.findByRole("button", { name: "Block" })).toBeInTheDocument();
});

// THIS TEST IS THE RULE, not a note about it. Public recipes stay readable to anyone signed
// out, so "cannot see" would be a promise the architecture cannot keep.
test("the block copy promises only what the architecture can keep", async () => {
  await renderOtherCook();
  expect(screen.getByText(/they will not see your recipes in potluck/i)).toBeInTheDocument();
  expect(screen.queryByText(/cannot see/i)).not.toBeInTheDocument();
});

test("reporting a cook sends the reason and the button reads Reported", async () => {
  await renderOtherCook();
  fireEvent.click(screen.getByRole("button", { name: "Report" }));
  fireEvent.change(screen.getByLabelText("reason"), { target: { value: "impersonation" } });
  fireEvent.change(screen.getByLabelText("note"), { target: { value: "not them" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  await waitFor(() =>
    expect(reportCook).toHaveBeenCalledWith("c1", "impersonation", "not them"));
  expect(await screen.findByRole("button", { name: "Reported" })).toBeInTheDocument();
});

// Found on PRODUCTION, not by a test: after blocking, the control still read "Following"
// while the database had already deleted the follow, because 0029 severs it server side and
// the page only updated its own block state. A reload fixed the display, which is exactly
// the kind of lie a reload hides.
test("blocking stops the control claiming you still follow them", async () => {
  mockAuth = { userId: "me", loading: false };
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: null, avatar_url: null,
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([]);
  vi.mocked(isFollowing).mockResolvedValue(true);
  renderCook();
  expect(await screen.findByRole("button", { name: "Following" })).toBeInTheDocument();

  fireEvent.click(await screen.findByRole("button", { name: "Block" }));
  await waitFor(() => expect(setBlock).toHaveBeenCalledWith("c1", "block"));
  expect(await screen.findByRole("button", { name: "Follow" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Following" })).not.toBeInTheDocument();
});
