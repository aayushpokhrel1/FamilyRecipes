import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import MyProfile from "./MyProfile";
import { getMyProfile } from "../lib/api/profile";

vi.mock("../lib/api/profile", () => ({ getMyProfile: vi.fn() }));

beforeEach(() => {
  vi.mocked(getMyProfile).mockReset();
});

// Renders /me inside a router that also owns /cooks/:handle, so the redirect can be observed
// by what lands rather than by mocking Navigate.
function renderMe() {
  render(
    <MemoryRouter initialEntries={["/me"]}>
      <Routes>
        <Route path="/me" element={<MyProfile />} />
        <Route path="/cooks/:handle" element={<div>cook page</div>} />
        <Route path="/settings" element={<div>settings page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

test("redirects a published cook to their own public page", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: "yusha" } as never);
  renderMe();
  expect(await screen.findByText("cook page")).toBeInTheDocument();
});

// The nav link is static, so an unpublished cook DOES reach this page. Hiding the link would
// make the feature invisible to exactly the people who have not found it yet, so the page has
// to say what is missing and where to fix it.
test("tells an unpublished cook what to do instead of redirecting", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: null } as never);
  renderMe();
  expect(await screen.findByText(/not published a profile yet/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  expect(screen.queryByText("cook page")).not.toBeInTheDocument();
});

// A failed lookup must not strand the page on a skeleton forever: the recovery is identical
// to the unpublished case, so it reads the same.
test("a failed profile lookup reads as not published", async () => {
  vi.mocked(getMyProfile).mockRejectedValue(new Error("network"));
  renderMe();
  expect(await screen.findByText(/not published a profile yet/i)).toBeInTheDocument();
});
