import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Moderation from "./Moderation";

const getMyProfile = vi.fn();
const getPublicCooks = vi.fn();
vi.mock("../../lib/api/profile", () => ({
  getMyProfile: (...a: any[]) => getMyProfile(...a),
  getPublicCooks: (...a: any[]) => getPublicCooks(...a),
}));

const listOpenReports = vi.fn();
const resolveReport = vi.fn();
vi.mock("../../lib/api/moderation", () => ({
  listOpenReports: (...a: any[]) => listOpenReports(...a),
  resolveReport: (...a: any[]) => resolveReport(...a),
}));

const listOpenAppeals = vi.fn();
const resolveAppeal = vi.fn();
vi.mock("../../lib/api/appeals", () => ({
  listOpenAppeals: (...a: any[]) => listOpenAppeals(...a),
  resolveAppeal: (...a: any[]) => resolveAppeal(...a),
}));

// The Recipes tab is the only consumer of these, and it is mounted only when selected, so
// the roster call never runs on the page's main job.
const getAdminStats = vi.fn();
const getAdminInsights = vi.fn();
// The Kitchen tab's own load, independent of both of the above.
const getKitchenInsights = vi.fn();
const listAdminUsers = vi.fn();
const listModerationEvents = vi.fn();
vi.mock("../../lib/api/admin", () => ({
  getAdminStats: (...a: any[]) => getAdminStats(...a),
  getAdminInsights: (...a: any[]) => getAdminInsights(...a),
  getKitchenInsights: (...a: any[]) => getKitchenInsights(...a),
  listAdminUsers: (...a: any[]) => listAdminUsers(...a),
  listModerationEvents: (...a: any[]) => listModerationEvents(...a),
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
  // The roster call now also reports whether the caller may change who moderates.
  listAdminUsers.mockResolvedValue({ users: [], hasMore: false, callerIsOwner: false });
  listModerationEvents.mockResolvedValue({ events: [], hasMore: false });
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
  // The recipes tab loads insights alongside stats, as an independent call: a default is needed
  // here or every test that renders the page hits an unmocked function. The two loads are
  // deliberately separate in the page, and the tests below pin that neither can blank the
  // other.
  getAdminInsights.mockResolvedValue({
    returning: {
      repeat: { all: 2, others: 1 },
      active7: { all: 3, others: 2 },
      active30: { all: 4, others: 3 },
      since: "2026-10-01",
    },
    funnel: {
      signedUp: { all: 6, others: 5 },
      joinedFamily: { all: 4, others: 3 },
      savedRecipe: { all: 2, others: 1 },
    },
    surfaces: [
      { surface: "recipes", all: 4, others: 3 },
      { surface: "potluck", all: 1, others: 0 },
    ],
    sources: [
      { source: "family", all: 2, others: 2 },
      { source: "uncredited", all: 4, others: 3 },
    ],
  });
  // The Kitchen tab is a separate product with its own load, and it is mounted only when
  // selected. A default is needed here for the same reason as the insights one above: the
  // page renders the tab's button on every render, and any test that clicks it would
  // otherwise hit an unmocked function.
  getKitchenInsights.mockResolvedValue({
    throughput: { started: 2, landed: 1, medianDays: 5, slowOverAMonth: 1 },
    activeStaff: 3,
    counts: { orgs: 0, sites: 0, staff: 0, dishes: 0, published: 0, openInvites: 0 },
    funnel: { created: 0, addedSite: 0, addedDish: 0, publishedDish: 0 },
    orgsByDay: {},
    newest: null,
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

  await userEvent.click(await screen.findByRole("button", { name: "Recipes" }));

  const users = (await screen.findByText("Users")).closest("li");
  expect(users).toHaveTextContent("3");
  const ever = screen.getByText("Ever joined").closest("li");
  expect(ever).toHaveTextContent("6");
});

// THE TWO LOADS ARE INDEPENDENT, and these two tests are why that cannot be quietly undone.
// The page's own comment on the stats error says a failed load "can never blank the page or
// take the other two sections down with it". Adding a second call put that at risk in both
// directions, and a shared error state would have been the easy way to write it.
test("a failed insights load leaves the tiles and the chart standing", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getAdminInsights.mockRejectedValue(new Error("insights are down"));
  render(<MemoryRouter><Moderation /></MemoryRouter>);

  await screen.findByRole("button", { name: "Recipes" });
  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));

  // The failure says so...
  expect(await screen.findByText("insights are down")).toBeInTheDocument();
  // ...and everything that did load is still there.
  expect(screen.getByText("Ever joined")).toBeInTheDocument();
  expect(screen.getByText("Signups, last 30 days")).toBeInTheDocument();
  // The panels that depend on it are gone rather than half-rendered.
  expect(screen.queryByText("Coming back")).not.toBeInTheDocument();
});

test("a failed stats load leaves the four panels standing", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getAdminStats.mockRejectedValue(new Error("stats are down"));
  render(<MemoryRouter><Moderation /></MemoryRouter>);

  await screen.findByRole("button", { name: "Recipes" });
  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));

  expect(await screen.findByText("stats are down")).toBeInTheDocument();
  expect(screen.getByText("Coming back")).toBeInTheDocument();
  expect(screen.getByText("Onboarding")).toBeInTheDocument();
});

// A DATE-ONLY STRING IS NOT AN INSTANT, and a browser walk on 2026-10-16 showed the
// "collecting began" line reporting 14 October for an earliest row of the 15th. new Date of a
// bare "YYYY-MM-DD" is UTC midnight, which toLocaleDateString renders as the previous day
// anywhere west of UTC. shortDay splits the parts instead.
test("the collecting-began date is not shifted by a day west of UTC", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getAdminInsights.mockResolvedValue({
    returning: {
      repeat: { all: 0, others: 0 },
      active7: { all: 0, others: 0 },
      active30: { all: 0, others: 0 },
      since: "2026-10-15",
    },
    funnel: {
      signedUp: { all: 0, others: 0 },
      joinedFamily: { all: 0, others: 0 },
      savedRecipe: { all: 0, others: 0 },
    },
    surfaces: [],
    sources: [],
  });
  render(<MemoryRouter><Moderation /></MemoryRouter>);

  await screen.findByRole("button", { name: "Recipes" });
  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));

  // The 15th, whatever the runner's timezone. Formatted with the same options the page uses,
  // from a LOCAL-midnight Date, so this asserts the behaviour and not one locale's wording.
  const expected = new Date(2026, 9, 15).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  expect(await screen.findByText(new RegExp(`Collecting began on ${expected}`))).toBeInTheDocument();
});

test("it says nothing has been recorded when there is no history at all", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getAdminInsights.mockResolvedValue({
    returning: {
      repeat: { all: 0, others: 0 },
      active7: { all: 0, others: 0 },
      active30: { all: 0, others: 0 },
      since: null,
    },
    funnel: {
      signedUp: { all: 0, others: 0 },
      joinedFamily: { all: 0, others: 0 },
      savedRecipe: { all: 0, others: 0 },
    },
    surfaces: [],
    sources: [],
  });
  render(<MemoryRouter><Moderation /></MemoryRouter>);

  await screen.findByRole("button", { name: "Recipes" });
  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));

  // A zero here must not read as a finding about the app.
  expect(await screen.findByText(/not low, they are unmeasured/)).toBeInTheDocument();
});

// The console now holds a SECOND product. The professional kitchen app is a separate schema
// sharing no data with the family app. It has been LIVE since 2026-10-12 and its tab is still
// close to a wall of zeros, because it is noindex and linked from nowhere, so it has no traffic
// by design. These tests pin the tab, the note that explains the zeros with the true reason,
// the throughput figures, and the fact that its own failure cannot take the Recipes tab down.
test("clicking Kitchen shows the counts, with a tile labelled Kitchens", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getKitchenInsights.mockResolvedValue({
    throughput: { started: 2, landed: 1, medianDays: 5, slowOverAMonth: 1 },
    activeStaff: 3,
    counts: { orgs: 2, sites: 3, staff: 4, dishes: 5, published: 1, openInvites: 6 },
    funnel: { created: 2, addedSite: 1, addedDish: 1, publishedDish: 0 },
    orgsByDay: {},
    newest: null,
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

  const kitchens = (await screen.findByText("Kitchens")).closest("li");
  expect(kitchens).toHaveTextContent("2");
  expect(screen.getByText("Venues").closest("li")).toHaveTextContent("3");
  expect(screen.getByText("Open invites").closest("li")).toHaveTextContent("6");
});

// THE NOTE IS THE POINT OF THE SECTION. Without it a wall of zeros reads as a bug rather than
// as an unused product, so this asserts on the wording that says so.
//
// IT ALSO PINS WHICH REASON IS GIVEN, and that is not pedantry. Until 2026-10-21 both this
// page and the edge function said the app was "not deployed yet", which stopped being true on
// 2026-10-12. A false excuse for a zero is worse than none: it would have been read back as
// evidence that the product was unfinished. The assertion below fails if that sentence returns.
test("the Kitchen section says the app is live with no traffic, so zeros are expected", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

  expect(
    await screen.findByText(/not indexed and nothing links to it, so it has no traffic by design/),
  ).toBeInTheDocument();
  expect(screen.getByText(/nobody has used it, not that anything is broken/)).toBeInTheDocument();
  expect(screen.queryByText(/not deployed yet/)).toBeNull();
});

test("shows kitchen throughput", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getKitchenInsights.mockResolvedValue({
    throughput: { started: 7, landed: 4, medianDays: 9, slowOverAMonth: 2 },
    activeStaff: 3,
    counts: { orgs: 2, sites: 3, staff: 6, dishes: 7, published: 1, openInvites: 1 },
    funnel: { created: 2, addedSite: 2, addedDish: 2, publishedDish: 1 },
    orgsByDay: {},
    newest: null,
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

  expect((await screen.findByText("Dishes started")).closest("li")).toHaveTextContent("7");
  expect(screen.getByText("Dishes signed off").closest("li")).toHaveTextContent("4");
  expect(screen.getByText("In development over a month").closest("li")).toHaveTextContent("2");
  expect(screen.getByText("Staff active this week").closest("li")).toHaveTextContent("3");
  expect(screen.getByText(/median dish takes 9 days/)).toBeInTheDocument();
});

// A null median is the honest answer for a group that has landed nothing, and the tile layout
// cannot say that: a stat tile is a number or it is a blank space. So the median lives in a
// sentence, and this pins that the sentence explains itself rather than printing "null".
test("says nothing has landed instead of printing a null median", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getKitchenInsights.mockResolvedValue({
    throughput: { started: 3, landed: 0, medianDays: null, slowOverAMonth: 1 },
    activeStaff: 0,
    counts: { orgs: 1, sites: 1, staff: 1, dishes: 3, published: 0, openInvites: 0 },
    funnel: { created: 1, addedSite: 1, addedDish: 1, publishedDish: 0 },
    orgsByDay: {},
    newest: null,
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

  expect(
    await screen.findByText(/No dish has been signed off yet, so there is no median to give/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/null/)).toBeNull();
});

// THE SEAL, STATED AS AN ASSERTION. A named person's attendance is a kitchen row, and this
// console must never hand one to a family moderator: the owner of a group sees their own staff
// by name inside the kitchen app, and here it is a count and nothing else. The payload cannot
// carry a name at all, so this asserts on the only thing the page could leak if somebody
// widened the select list in the edge function: a staff member's name on screen.
test("names no kitchen staff member", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getKitchenInsights.mockResolvedValue({
    throughput: { started: 2, landed: 1, medianDays: 5, slowOverAMonth: 0 },
    activeStaff: 2,
    counts: { orgs: 1, sites: 1, staff: 2, dishes: 2, published: 1, openInvites: 0 },
    funnel: { created: 1, addedSite: 1, addedDish: 1, publishedDish: 1 },
    orgsByDay: {},
    newest: null,
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

  expect(await screen.findByText("Staff active this week")).toBeInTheDocument();
  expect(screen.getByText(/counts people and never names them/)).toBeInTheDocument();
  // The shape of a leak: anything that reads as a person rather than as a figure.
  expect(screen.queryByText(/Sam|Ruth|@/)).toBeNull();
});

// The Kitchen tab's load is its own, exactly like the two inside Recipes: a failure there
// must not blank a tab that loaded perfectly, and switching back must still show it.
test("a failed kitchen load shows its message and does not blank the Recipes section", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getKitchenInsights.mockRejectedValue(new Error("kitchen insights are down"));
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Kitchen" }));
  expect(await screen.findByText("kitchen insights are down")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));
  expect(await screen.findByText("Signups, last 30 days")).toBeInTheDocument();
});

// The family app's own `kitchen` surface is a cook's MEAL PLANS, and the raw key sitting next
// to a Kitchen tab reads as the other product's numbers. The label is the whole reason the
// mapping exists.
test("the features table labels the kitchen surface as Meal plans", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  getAdminInsights.mockResolvedValue({
    returning: {
      repeat: { all: 0, others: 0 },
      active7: { all: 0, others: 0 },
      active30: { all: 0, others: 0 },
      since: null,
    },
    funnel: {
      signedUp: { all: 0, others: 0 },
      joinedFamily: { all: 0, others: 0 },
      savedRecipe: { all: 0, others: 0 },
    },
    surfaces: [{ surface: "kitchen", all: 3, others: 2 }],
    sources: [],
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Recipes" }));

  expect(await screen.findByText("Meal plans")).toBeInTheDocument();
  expect(screen.queryByText("kitchen")).not.toBeInTheDocument();
});

// THE TRAIL (0066). These are about the console's reading of it; the writing is proved in
// tests/integration/moderation_trail.test.ts against a real database, which is the only thing
// that can tell a correct policy from a present one.
test("the Trail names who acted, what they did and which door it came through", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listModerationEvents.mockResolvedValue({
    events: [{
      id: "e1", at: "2026-10-26T10:00:00Z", action: "suspend", via: "report",
      actorName: "Aayush", subjectName: "Nana Rose", subjectRecipe: null, reason: "spam",
    }],
    hasMore: false,
  });
  render(<MemoryRouter><Moderation /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "Trail" }));

  expect(await screen.findByText("Aayush")).toBeInTheDocument();
  // The WORDS, not the raw keys. A raw 'suspend' sitting in a table is the same failure the
  // SURFACE_LABELS comment in Moderation.tsx describes.
  expect(screen.getByText(/Suspended a cook/)).toBeInTheDocument();
  expect(screen.getByText(/From a report/)).toBeInTheDocument();
  expect(screen.getByText("Nana Rose")).toBeInTheDocument();
  expect(screen.getByText("spam")).toBeInTheDocument();
});

test("the Trail says nothing has been taken rather than showing an empty table", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  render(<MemoryRouter><Moderation /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "Trail" }));

  expect(await screen.findByText("No moderator action has been taken yet.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
});

test("a failed Trail load shows its message", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listModerationEvents.mockRejectedValue(new Error("the trail is unavailable"));
  render(<MemoryRouter><Moderation /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "Trail" }));

  expect(await screen.findByText("the trail is unavailable")).toBeInTheDocument();
});

const rosterUser = {
  id: "u9", email: "a@b.dev", emailConfirmed: true, lastSignInAt: null,
  createdAt: "2026-10-01T00:00:00Z", provider: "email", displayName: "Someone",
  handle: null, isModerator: false, suspendedAt: null, suspendedReason: null, recipes: 0,
};

// Two tests rather than one with a re-render, because the thing being asserted is an ABSENCE in
// the first case: a second render in the same test leaves the first one's DOM in place, and a
// query that finds nothing cannot tell which render it failed to find it in.
test("a plain moderator is not offered the moderator control", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listAdminUsers.mockResolvedValue({ users: [rosterUser], hasMore: false, callerIsOwner: false });
  render(<MemoryRouter><Moderation /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "People" }));

  expect(await screen.findByText("Someone")).toBeInTheDocument();
  // Not a cosmetic choice: set_moderator refuses a non-owner, and CLAUDE.md's rule is that a
  // page must not render a control its viewer's policy will refuse.
  expect(screen.queryByRole("button", { name: "Make moderator" })).toBeNull();
});

test("the owner is offered the moderator control", async () => {
  getMyProfile.mockResolvedValue({ id: "u1", is_moderator: true });
  listAdminUsers.mockResolvedValue({ users: [rosterUser], hasMore: false, callerIsOwner: true });
  render(<MemoryRouter><Moderation /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "People" }));

  expect(await screen.findByRole("button", { name: "Make moderator" })).toBeInTheDocument();
});
