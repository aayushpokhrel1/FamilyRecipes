import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Moderation from "./Moderation";

const getMyProfile = vi.fn();
vi.mock("../lib/api/profile", () => ({
  getMyProfile: (...a: any[]) => getMyProfile(...a),
}));

const listOpenReports = vi.fn();
const resolveReport = vi.fn();
vi.mock("../lib/api/moderation", () => ({
  listOpenReports: (...a: any[]) => listOpenReports(...a),
  resolveReport: (...a: any[]) => resolveReport(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: false });
  listOpenReports.mockResolvedValue([]);
  resolveReport.mockResolvedValue(undefined);
});

function report(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    recipe_id: "r1",
    reporter_id: "u2",
    reason: "offensive" as const,
    note: null,
    status: "open" as const,
    created_at: "2026-09-28T00:00:00Z",
    recipes: { title: "Dal" },
    ...overrides,
  };
}

// A cook report names a cook instead of a recipe: cook_id is set, recipe_id is null and
// there is no embedded recipe, only the embedded cook profile.
function cookReport(id: string, overrides: Record<string, unknown> = {}) {
  return report(id, {
    recipe_id: null,
    cook_id: "c1",
    recipes: null,
    profiles: { handle: "nana", public_name: "Nana Rose" },
    ...overrides,
  });
}

// The row contains a Link, so every render needs a router.
function renderPage() {
  return render(
    <MemoryRouter>
      <Moderation />
    </MemoryRouter>,
  );
}

// The route checks the flag itself. A hidden nav link is not a permission: anyone can type
// the URL, so this is the test that says the page refuses on its own.
test("a non-moderator sees Not found and no report list", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: false });
  renderPage();
  expect(await screen.findByText("Not found")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Moderation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  // And it never even asks for the queue.
  expect(listOpenReports).not.toHaveBeenCalled();
});

test("a moderator sees the recipe title, the reason label and the note", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([
    report("rep1", { reason: "not_theirs", note: "This is my grandmother's recipe." }),
  ]);
  renderPage();

  expect(await screen.findByRole("heading", { name: "Moderation" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dal" })).toHaveAttribute("href", "/recipes/r1");
  expect(screen.getByText("Not theirs to publish")).toBeInTheDocument();
  expect(screen.getByText("This is my grandmother's recipe.")).toBeInTheDocument();
});

test("a report with no embedded recipe reads Untitled", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([report("rep1", { recipes: null })]);
  renderPage();
  expect(await screen.findByRole("link", { name: "Untitled" })).toBeInTheDocument();
});

test("clicking Unpublish calls resolveReport and the row disappears", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([report("rep1")]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Unpublish" }));

  expect(resolveReport).toHaveBeenCalledWith("rep1", "unpublish", "offensive");
  // Dropped from local state, not refetched: the queue must not be asked for again.
  await waitFor(() => expect(screen.queryByRole("link", { name: "Dal" })).not.toBeInTheDocument());
  expect(listOpenReports).toHaveBeenCalledTimes(1);
});

test("clicking Suspend cook calls resolveReport with suspend", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([report("rep1", { reason: "impersonation" })]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Suspend cook" }));

  expect(resolveReport).toHaveBeenCalledWith("rep1", "suspend", "impersonation");
});

test("clicking Dismiss calls resolveReport with dismiss", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([report("rep1", { reason: "other" })]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

  expect(resolveReport).toHaveBeenCalledWith("rep1", "dismiss", "other");
});

test("a cook report shows the public name and links to the cook, not a recipe", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([cookReport("rep1")]);
  renderPage();

  expect(await screen.findByRole("link", { name: "Nana Rose" })).toHaveAttribute(
    "href",
    "/cooks/nana",
  );
  expect(screen.queryByRole("link", { name: "Untitled" })).not.toBeInTheDocument();
});

test("a cook report with no public name falls back to the handle", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([
    cookReport("rep1", { profiles: { handle: "nana", public_name: null } }),
  ]);
  renderPage();

  expect(await screen.findByRole("link", { name: "nana" })).toHaveAttribute("href", "/cooks/nana");
});

test("a cook report offers Clear name, Suspend cook and Dismiss, but not Unpublish", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([cookReport("rep1")]);
  renderPage();

  expect(await screen.findByRole("button", { name: "Clear name" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suspend cook" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
});

test("a recipe report still offers Unpublish and not Clear name", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([report("rep1")]);
  renderPage();

  expect(await screen.findByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  // Suspend cook belongs to BOTH kinds of report. It was dropped from this branch once.
  expect(screen.getByRole("button", { name: "Suspend cook" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Clear name" })).not.toBeInTheDocument();
});

test("clicking Clear name calls resolveReport with clear_name", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([cookReport("rep1", { reason: "impersonation" })]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Clear name" }));

  expect(resolveReport).toHaveBeenCalledWith("rep1", "clear_name", "impersonation");
});
