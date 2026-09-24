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
}));
vi.mock("../lib/api/auth", () => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/theme", () => ({
  getTheme: vi.fn().mockReturnValue("system"),
  setTheme: vi.fn(),
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
