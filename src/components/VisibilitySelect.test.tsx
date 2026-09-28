import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, test, expect } from "vitest";
import VisibilitySelect from "./VisibilitySelect";
import { getMyProfile } from "../lib/api/profile";
import type { Profile } from "../lib/api/types";

vi.mock("../lib/api/profile", () => ({ getMyProfile: vi.fn() }));

function renderSelect(onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <VisibilitySelect value="family" onChange={onChange} />
    </MemoryRouter>,
  );
  return onChange;
}

test("warns, but still publishes, when the cook has no handle", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: null } as Profile);
  const onChange = renderSelect();
  const select = await screen.findByLabelText(/visibility/i);
  fireEvent.change(select, { target: { value: "public" } });

  expect(await screen.findByText(/claim a handle/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  // The selection is NOT blocked: recipes_read does not consult the handle, so the recipe
  // really is public either way and pretending otherwise would misstate the database.
  expect(onChange).toHaveBeenCalledWith("public");
});

test("publishes without complaint once a handle exists", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: "aayush" } as Profile);
  const onChange = renderSelect();
  const select = await screen.findByLabelText(/visibility/i);
  // Wait for the profile to land before changing, or the note would show for the honest
  // reason that the handle is not known yet.
  await screen.findByRole("option", { name: "public" });
  fireEvent.change(select, { target: { value: "public" } });

  expect(onChange).toHaveBeenCalledWith("public");
  expect(screen.queryByText(/claim a handle/i)).not.toBeInTheDocument();
});

test("says nothing when choosing a non-public visibility", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: null } as Profile);
  renderSelect();
  const select = await screen.findByLabelText(/visibility/i);
  fireEvent.change(select, { target: { value: "private" } });
  expect(screen.queryByText(/claim a handle/i)).not.toBeInTheDocument();
});
