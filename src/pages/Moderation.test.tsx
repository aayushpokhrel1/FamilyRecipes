import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Moderation from "./Moderation";

const getMyProfile = vi.fn();
const getPublicCooks = vi.fn();
vi.mock("../lib/api/profile", () => ({
  getMyProfile: (...a: any[]) => getMyProfile(...a),
  getPublicCooks: (...a: any[]) => getPublicCooks(...a),
}));

const listOpenReports = vi.fn();
const resolveReport = vi.fn();
vi.mock("../lib/api/moderation", () => ({
  listOpenReports: (...a: any[]) => listOpenReports(...a),
  resolveReport: (...a: any[]) => resolveReport(...a),
}));

const listOpenAppeals = vi.fn();
const resolveAppeal = vi.fn();
vi.mock("../lib/api/appeals", () => ({
  listOpenAppeals: (...a: any[]) => listOpenAppeals(...a),
  resolveAppeal: (...a: any[]) => resolveAppeal(...a),
}));

// The Overview tab is the only consumer of these, and it is mounted only when selected, so
// the roster call never runs on the page's main job.
const getAdminStats = vi.fn();
vi.mock("../lib/api/admin", () => ({
  getAdminStats: (...a: any[]) => getAdminStats(...a),
  listAdminUsers: vi.fn().mockResolvedValue({ users: [], hasMore: false }),
  setModerator: vi.fn(),
  suspendUser: vi.fn(),
  unsuspendUser: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: false });
  listOpenReports.mockResolvedValue([]);
  listOpenAppeals.mockResolvedValue([]);
  // public_cooks is how the queue turns a reported cook id into a name: profiles itself is
  // readable only to its owner, so a PostgREST embed would be null for every cook report.
  getPublicCooks.mockResolvedValue(new Map([
    ["c1", { id: "c1", handle: "nana", public_name: "Nana Rose", bio: null, avatar_url: null }],
  ]));
  resolveReport.mockResolvedValue(undefined);
  getAdminStats.mockResolvedValue({
    users: 3, everJoined: 6, recipes: 9, published: 4, removed: 1,
    families: 2, openReports: 0, suspended: 0, signupsByDay: {},
  });
  resolveAppeal.mockResolvedValue(undefined);
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

// A cook report names a cook instead of a recipe: cook_id is set and recipe_id is null. The
// name is NOT on the row, it is looked up through public_cooks.
function cookReport(id: string, overrides: Record<string, unknown> = {}) {
  return report(id, { recipe_id: null, cook_id: "c1", recipes: null, ...overrides });
}

// An appeal row. subject_id is null for a name appeal, because there the subject IS the cook,
// and the embedded recipe title is null for anything but a recipe appeal.
function appeal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    cook_id: "c1",
    subject_type: "name" as const,
    subject_id: null,
    body: "That is my own name.",
    created_at: "2026-09-28T00:00:00Z",
    resolved_at: null,
    outcome: null,
    moderator_note: null,
    recipes: null,
    ...overrides,
  };
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
  listOpenReports.mockResolvedValue([cookReport("rep1")]);
  getPublicCooks.mockResolvedValue(new Map([
    ["c1", { id: "c1", handle: "nana", public_name: null, bio: null, avatar_url: null }],
  ]));
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

// A cook with no public page (no handle) has nothing to link to, and a link to
// /cooks/undefined is worse than plain text. This also covers the case the queue used to get
// wrong for EVERY cook report, when the name came from a profiles embed RLS always emptied.
test("a reported cook with no public page renders as plain text, not a broken link", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenReports.mockResolvedValue([cookReport("rep1")]);
  getPublicCooks.mockResolvedValue(new Map());
  renderPage();

  expect(await screen.findByText("Unknown cook")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /unknown cook/i })).not.toBeInTheDocument();
});

// The appeals queue is a separate view, mounted only when it is selected, so its query never
// runs on the page's main job.
test("lists an open appeal with the cook, the subject and their words", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenAppeals.mockResolvedValue([appeal("a1")]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));

  expect(await screen.findByRole("link", { name: "Nana Rose" })).toHaveAttribute(
    "href",
    "/cooks/nana",
  );
  expect(screen.getByText("A cleared public name")).toBeInTheDocument();
  expect(screen.getByText("That is my own name.")).toBeInTheDocument();
});

test("grants an appeal through the RPC and drops the row", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenAppeals.mockResolvedValue([appeal("a1")]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));
  await userEvent.click(await screen.findByRole("button", { name: "Grant" }));

  expect(resolveAppeal).toHaveBeenCalledWith("a1", "granted", "");
  // Dropped from local state, not refetched: the queue must not be asked for again.
  await waitFor(() => expect(screen.queryByText("That is my own name.")).not.toBeInTheDocument());
  expect(listOpenAppeals).toHaveBeenCalledTimes(1);
});

// A note is optional for both outcomes: nothing requires a moderator to explain a decline,
// and forcing prose would produce "no" written longer.
test("declines with an optional note", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenAppeals.mockResolvedValue([appeal("a1")]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));
  await userEvent.type(await screen.findByLabelText("Note for Nana Rose"), "Not this time.");
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));

  expect(resolveAppeal).toHaveBeenCalledWith("a1", "declined", "Not this time.");
});

// The note is keyed per row. One shared field showed every row the same text and sent
// whatever was typed anywhere as the note on whichever appeal was resolved, so a note
// written about one cook arrived on another cook's decision.
test("keeps each row's note to that row", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenAppeals.mockResolvedValue([appeal("a1"), appeal("a2", { cook_id: "c2" })]);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));
  // c2 is absent from the public_cooks map, so its row falls back to "this cook": the two
  // inputs are therefore distinguishable, which is the point.
  await userEvent.type(await screen.findByLabelText("Note for Nana Rose"), "Granting this.");
  expect(screen.getByLabelText("Note for this cook")).toHaveValue("");

  await userEvent.click(screen.getAllByRole("button", { name: "Decline" })[1]);
  expect(resolveAppeal).toHaveBeenCalledWith("a2", "declined", "");
});

test("keeps the row and shows the message when a resolve fails", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listOpenAppeals.mockResolvedValue([appeal("a1")]);
  resolveAppeal.mockRejectedValueOnce(new Error("Only a moderator can resolve an appeal."));
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));
  await userEvent.click(await screen.findByRole("button", { name: "Grant" }));

  expect(await screen.findByText("Only a moderator can resolve an appeal.")).toBeInTheDocument();
  // The row stays: a failed resolve must not read as a resolved one.
  expect(screen.getByText("That is my own name.")).toBeInTheDocument();
});

test("shows an ordinary cook nothing", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: false });
  renderPage();

  expect(await screen.findByText("Not found")).toBeInTheDocument();
  // And it never even asks for the queue.
  expect(listOpenAppeals).not.toHaveBeenCalled();
});

// A profile OUTLIVES its login (0014), so the profiles count includes every account ever
// deleted. One tile labelled "Users" showing that number read as 6 where there were 3 logins,
// with nothing on screen saying why. The two counts answer different questions and are shown
// as two tiles.
test("shows live logins and accounts-ever-joined as separate tiles", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Overview" }));

  const users = (await screen.findByText("Users")).closest("li");
  expect(users).toHaveTextContent("3");
  const ever = screen.getByText("Ever joined").closest("li");
  expect(ever).toHaveTextContent("6");
});
