import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import Settings from "./Settings";

vi.mock("../lib/api/profile", () => ({
  getMyProfile: vi.fn().mockResolvedValue({
    id: "u1", display_name: "Ada", avatar_url: null, preferences: {},
  }),
  updateDisplayName: vi.fn().mockResolvedValue(undefined),
  updatePreferences: vi.fn().mockResolvedValue({}),
  uploadAvatar: vi.fn().mockResolvedValue("u1/new-avatar"),
  getAvatarUrl: vi.fn().mockResolvedValue("https://example.test/signed"),
}));
vi.mock("../lib/api/account", () => ({
  deleteAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/api/auth", () => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
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
