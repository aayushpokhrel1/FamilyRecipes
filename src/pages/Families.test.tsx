import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import Families from "./Families";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    families: [{ id: "f1", name: "Pokhrel", invite_code: "abc123", created_by: "u1", role: "owner" }],
    reload: vi.fn(),
  }),
}));
vi.mock("../lib/api/families", () => ({
  createFamily: vi.fn(),
  joinByCode: vi.fn(),
}));

function renderFamilies() {
  render(<MemoryRouter><Families /></MemoryRouter>);
}

test("copies the full invite link", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  renderFamilies();
  fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toMatch(/\/join\/abc123$/);
});

// A clipboard that is missing or refuses must not leave the person with nothing.
test("falls back to a readonly input when the clipboard rejects", async () => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  renderFamilies();
  fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
  const input = await screen.findByLabelText("Invite link");
  expect(input).toHaveValue(`${window.location.origin}/join/abc123`);
  expect(input).toHaveAttribute("readonly");
});
