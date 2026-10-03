import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import Settings from "./Settings";

vi.mock("../lib/api/profile", async () => {
  // handleError is the real validator, not a stub: the test that an invalid handle never
  // reaches the API is only meaningful if the thing doing the rejecting is the real one.
  const actual = await vi.importActual<typeof import("../lib/api/profile")>("../lib/api/profile");
  return {
    getMyProfile: vi.fn().mockResolvedValue({
      id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
      handle: null, public_name: null, bio: null,
    }),
    updateDisplayName: vi.fn().mockResolvedValue(undefined),
    updatePreferences: vi.fn().mockResolvedValue({}),
    uploadAvatar: vi.fn().mockResolvedValue("u1/new-avatar"),
    getAvatarUrl: vi.fn().mockResolvedValue("https://example.test/signed"),
    handleError: actual.handleError,
    updatePublicProfile: vi.fn().mockResolvedValue(undefined),
    unpublishProfile: vi.fn().mockResolvedValue(undefined),
    getPublicCooks: vi.fn().mockResolvedValue(new Map()),
  };
});
vi.mock("../lib/api/account", () => ({
  deleteAccount: vi.fn().mockResolvedValue(undefined),
}));
// The list is loaded with ONE listMyBlocks() call, so the mock hands back the whole list.
vi.mock("../lib/api/blocks", () => ({
  listMyBlocks: vi.fn().mockResolvedValue([]),
  removeBlock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/api/auth", () => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
}));
// The appeals list is loaded with ONE listMyAppeals() call, so the mock hands back the whole
// list, and an empty one by default: the cleared-name notice is hidden for most tests.
vi.mock("../lib/api/appeals", () => ({
  listMyAppeals: vi.fn().mockResolvedValue([]),
  createAppeal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/theme", () => ({
  getTheme: vi.fn().mockReturnValue("system"),
  setTheme: vi.fn(),
}));
// FamilyDataPanel is rendered inside Settings, and it reads the active family.
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" },
  }),
}));

test("refuses a mismatched confirmation without calling changePassword", async () => {
  const auth = await import("../lib/api/auth");
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-one" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Those passwords do not match.");
  expect(auth.changePassword).not.toHaveBeenCalled();
});

test("renders the heading and seeds the display name from the profile", async () => {
  render(<MemoryRouter><Settings /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByLabelText("Display name")).toHaveValue("Ada");
});

test("saves the trimmed display name", async () => {
  const profile = await import("../lib/api/profile");
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Ada Lovelace  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(profile.updateDisplayName).toHaveBeenCalledWith("Ada Lovelace"));
  expect(await screen.findByRole("status")).toHaveTextContent("Display name saved.");
  expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
});

test("choosing a theme goes to the theme module, not to preferences", async () => {
  const theme = await import("../lib/theme");
  const profile = await import("../lib/api/profile");
  (profile.updatePreferences as any).mockClear();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

  expect(theme.setTheme).toHaveBeenCalledWith("dark");
  expect(profile.updatePreferences).not.toHaveBeenCalled();
});

test("the delete confirm button stays disabled until the text is exactly DELETE", async () => {
  const account = await import("../lib/api/account");
  (account.deleteAccount as any).mockClear();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  const confirmButton = screen.getByRole("button", { name: "Delete my account" });
  expect(confirmButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "delete" } });
  expect(confirmButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE " } });
  expect(confirmButton).toBeDisabled();

  fireEvent.click(confirmButton);
  expect(account.deleteAccount).not.toHaveBeenCalled();
});

test("typing DELETE and confirming deletes the account once", async () => {
  const account = await import("../lib/api/account");
  (account.deleteAccount as any).mockClear();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

  await waitFor(() => expect(account.deleteAccount).toHaveBeenCalledTimes(1));
});

test("an oversized picture reports the size error and never uploads", async () => {
  const profile = await import("../lib/api/profile");
  (profile.uploadAvatar as any).mockClear();
  // The size check lives in uploadAvatar, so the mock rejects the way the real one does.
  (profile.uploadAvatar as any).mockRejectedValueOnce(new Error("Images must be under 2 MB."));
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  const big = new File([new ArrayBuffer(3 * 1024 * 1024)], "big.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose a picture"), { target: { files: [big] } });

  expect(await screen.findByRole("alert")).toHaveTextContent("Images must be under 2 MB.");
  expect(profile.uploadAvatar).toHaveBeenCalledTimes(1);
});

test("claims a handle and reports a taken one", async () => {
  const profile = await import("../lib/api/profile");
  (profile.updatePublicProfile as any).mockClear();
  vi.mocked(profile.updatePublicProfile).mockRejectedValueOnce(new Error("That handle is taken."));
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const input = await screen.findByLabelText(/handle/i);
  fireEvent.change(input, { target: { value: "aayush" } });
  fireEvent.click(screen.getByRole("button", { name: /publish my profile/i }));
  expect(await screen.findByText(/that handle is taken/i)).toBeInTheDocument();
});

test("rejects an invalid handle before calling the API", async () => {
  const profile = await import("../lib/api/profile");
  (profile.updatePublicProfile as any).mockClear();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const input = await screen.findByLabelText(/handle/i);
  fireEvent.change(input, { target: { value: "Aayush" } });
  fireEvent.click(screen.getByRole("button", { name: /publish my profile/i }));
  expect(await screen.findByText(/lowercase/i)).toBeInTheDocument();
  expect(profile.updatePublicProfile).not.toHaveBeenCalled();
});

test("links to your own public page once a handle exists", async () => {
  // A cook page reachable only by typing its URL is a feature with no entry point.
  const profile = await import("../lib/api/profile");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: "Aayush", bio: null,
  });
  render(<MemoryRouter><Settings /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: /view my public page/i }))
    .toHaveAttribute("href", "/cooks/yusha");
});

// A block you cannot find again is a trap: the only way back is a list like this one, so
// every row has to say which it is and carry its own Undo.
test("lists the muted and blocked cooks, each labelled and each with an Undo", async () => {
  const blocks = await import("../lib/api/blocks");
  const profile = await import("../lib/api/profile");
  (blocks.listMyBlocks as any).mockResolvedValue([
    { blocker_id: "u1", blocked_id: "c1", kind: "block", created_at: "2026-09-28T00:00:00Z" },
    { blocker_id: "u1", blocked_id: "c2", kind: "mute", created_at: "2026-09-27T00:00:00Z" },
  ]);
  // public_name when there is one, the handle otherwise.
  (profile.getPublicCooks as any).mockResolvedValue(new Map([
    ["c1", { id: "c1", handle: "mei", public_name: "Mei", bio: null, avatar_url: null }],
    ["c2", { id: "c2", handle: "bo", public_name: null, bio: null, avatar_url: null }],
  ]));
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  // Names, never the raw uuids: a list of ids is not a list of people.
  expect(await screen.findByText("Mei")).toBeInTheDocument();
  expect(screen.getByText("bo")).toBeInTheDocument();
  expect(screen.queryByText("c1")).not.toBeInTheDocument();
  expect(screen.getByText("blocked")).toBeInTheDocument();
  expect(screen.getByText("muted")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
  // One call for the whole list, never one per row.
  expect(blocks.listMyBlocks).toHaveBeenCalledTimes(1);
});

test("Undo calls removeBlock and the row leaves the list", async () => {
  const blocks = await import("../lib/api/blocks");
  const profile = await import("../lib/api/profile");
  (blocks.removeBlock as any).mockClear();
  // No public_cooks row for this id: an earlier test left one in the mock, so say so here.
  (profile.getPublicCooks as any).mockResolvedValue(new Map());
  (blocks.listMyBlocks as any).mockResolvedValue([
    { blocker_id: "u1", blocked_id: "c1", kind: "block", created_at: "2026-09-28T00:00:00Z" },
  ]);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  // No public_cooks row for this id, so the row renders the honest fallback rather than a uuid.
  await screen.findByText(/no longer publishes/i);

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

  await waitFor(() => expect(blocks.removeBlock).toHaveBeenCalledWith("c1"));
  // Dropped from local state, not refetched: the list must not be asked for again.
  await waitFor(() => expect(screen.queryByText(/no longer publishes/i)).not.toBeInTheDocument());
  expect(blocks.listMyBlocks).toHaveBeenCalledTimes(1);
});

test("an empty list is a plain line of text, not an empty box", async () => {
  const blocks = await import("../lib/api/blocks");
  (blocks.listMyBlocks as any).mockResolvedValue([]);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(await screen.findByText(/not muted or blocked anyone/i)).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("a cleared public name says so and shows the reason label", async () => {
  const profile = await import("../lib/api/profile");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: null, bio: null,
    name_cleared_at: "2026-09-28T00:00:00Z", name_cleared_reason: "impersonation",
  });
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(await screen.findByText(/public name was removed/i)).toBeInTheDocument();
  expect(screen.getByText(/Impersonation/)).toBeInTheDocument();
});

test("a profile whose name was never cleared shows no such notice", async () => {
  const profile = await import("../lib/api/profile");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: "Aayush", bio: null,
    name_cleared_at: null, name_cleared_reason: null,
  });
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(screen.queryByText(/public name was removed/i)).not.toBeInTheDocument();
});

// The cleared cook was told in Settings that they can appeal, so Settings is where the form
// has to be. A form on a page they were never sent to is decorative.
test("offers the appeal form to a cook whose public name was cleared", async () => {
  const profile = await import("../lib/api/profile");
  const appeals = await import("../lib/api/appeals");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: null, bio: null,
    name_cleared_at: "2026-09-28T00:00:00Z", name_cleared_reason: "impersonation",
  });
  (appeals.listMyAppeals as any).mockResolvedValue([]);
  (appeals.createAppeal as any).mockClear();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.change(await screen.findByLabelText("Why this was wrong"), {
    target: { value: "That is my own name." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Appeal this" }));

  await waitFor(() =>
    expect(appeals.createAppeal).toHaveBeenCalledWith("name", null, "That is my own name."),
  );
});

test("shows the pending note instead of the form once an appeal is open", async () => {
  const profile = await import("../lib/api/profile");
  const appeals = await import("../lib/api/appeals");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: null, bio: null,
    name_cleared_at: "2026-09-28T00:00:00Z", name_cleared_reason: "impersonation",
  });
  (appeals.listMyAppeals as any).mockResolvedValue([{
    id: "a1", cook_id: "u1", subject_type: "name", subject_id: null,
    body: "That is my own name.", created_at: "2026-09-28T00:00:00Z",
    resolved_at: null, outcome: null, moderator_note: null,
  }]);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(await screen.findByText(/your appeal is with a moderator/i)).toBeInTheDocument();
  // The cook's own words, so they can see what they said.
  expect(screen.getByText("That is my own name.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Appeal this" })).not.toBeInTheDocument();
});

// A declined appeal is final, so the form must not come back: offering it again would invite
// a second appeal the unique index would refuse anyway.
test("shows a declined outcome and does not offer the form again", async () => {
  const profile = await import("../lib/api/profile");
  const appeals = await import("../lib/api/appeals");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: null, bio: null,
    name_cleared_at: "2026-09-28T00:00:00Z", name_cleared_reason: "impersonation",
  });
  (appeals.listMyAppeals as any).mockResolvedValue([{
    id: "a1", cook_id: "u1", subject_type: "name", subject_id: null,
    body: "That is my own name.", created_at: "2026-09-28T00:00:00Z",
    resolved_at: "2026-09-29T00:00:00Z", outcome: "declined",
    moderator_note: "The name belongs to someone else.",
  }]);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(await screen.findByText("Your appeal was declined.")).toBeInTheDocument();
  expect(screen.getByText("The name belongs to someone else.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Appeal this" })).not.toBeInTheDocument();
});

// The API layer writes the user-facing message, so the screen shows it verbatim rather than
// restating the rule in a second place.
test("shows the API's refusal verbatim", async () => {
  const profile = await import("../lib/api/profile");
  const appeals = await import("../lib/api/appeals");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: null, bio: null,
    name_cleared_at: "2026-09-28T00:00:00Z", name_cleared_reason: "impersonation",
  });
  (appeals.listMyAppeals as any).mockResolvedValue([]);
  (appeals.createAppeal as any).mockRejectedValueOnce(
    new Error("You already have an open appeal for this."),
  );
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  fireEvent.change(await screen.findByLabelText("Why this was wrong"), {
    target: { value: "That is my own name." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Appeal this" }));

  // findByText, NOT findByRole("alert"): FamilyDataPanel renders its own alert on this
  // fixture, and a page-wide role query matches whichever arrives first.
  expect(await screen.findByText("You already have an open appeal for this."))
    .toHaveAttribute("role", "alert");
});

test("offers no appeal form to a cook who was never moderated", async () => {
  const profile = await import("../lib/api/profile");
  const appeals = await import("../lib/api/appeals");
  (profile.getMyProfile as any).mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
    handle: "yusha", public_name: "Aayush", bio: null,
    name_cleared_at: null, name_cleared_reason: null,
  });
  (appeals.listMyAppeals as any).mockResolvedValue([]);
  render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });

  expect(screen.queryByRole("button", { name: "Appeal this" })).not.toBeInTheDocument();
});
