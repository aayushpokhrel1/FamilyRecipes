import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, getPublicCooks } from "../lib/api/profile";
import { listOpenReports, resolveReport } from "../lib/api/moderation";
import { listOpenAppeals, resolveAppeal } from "../lib/api/appeals";
import {
  deleteUserAccount,
  getAdminInsights,
  getAdminStats,
  getKitchenInsights,
  listAdminUsers,
  listModerationEvents,
  setModerator,
  suspendUser,
  unsuspendUser,
  type AdminInsights,
  type AdminStats,
  type AdminUser,
  type KitchenInsights,
  type ModerationEvent,
} from "../lib/api/admin";
import { REASON_LABELS, type AppealRow, type PublicCook, type ReportRow } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

type View = "reports" | "appeals" | "recipes" | "people" | "kitchen" | "trail";

// A short date for the roster. A timestamptz is a real instant, so toLocaleDateString is
// right here, and a null last sign-in is a real answer (never signed in) rather than a
// missing one, so it renders as a dash instead of an empty cell.
//
// DO NOT PASS A DATE-ONLY STRING TO THIS. See shortDay below, and the bug it exists for.
function shortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// A short date for a DATE-ONLY string, "YYYY-MM-DD", which is a different thing from the
// instant shortDate takes, and using shortDate for one is a visible bug rather than a
// pedantic distinction.
//
// `new Date("2026-10-15")` is parsed as UTC midnight, so toLocaleDateString renders it as the
// 14th anywhere west of UTC. A browser walk on 2026-10-16 caught the "collecting began on"
// line reporting a day earlier than the earliest row. Splitting the parts and using the
// three-argument Date constructor builds LOCAL midnight, which is what a bare date means to
// the person reading it. The same UTC-shift trap as lastThirtyDays below, one layer up.
function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// The last 30 days as "YYYY-MM-DD", oldest first, gaps filled with zero. Built from local
// date parts rather than toISOString(): that converts to UTC, so local midnight in any UTC+
// timezone reports the previous day and the whole row shifts by one.
function lastThirtyDays(byDay: Record<string, number>): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 29);
  for (let i = 0; i < 30; i++) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    out.push({ day, count: byDay[day] ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function Moderation() {
  const [profile, setProfile] = useState<{ is_moderator: boolean } | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cooks, setCooks] = useState<Map<string, PublicCook>>(new Map());
  const [view, setView] = useState<View>("reports");

  useEffect(() => {
    let ignore = false;
    (async () => {
      const p = await getMyProfile();
      if (ignore) return;
      setProfile(p);
      // Only a moderator can read the queue at all, so a non-moderator never asks for it.
      if (p.is_moderator) {
        const rows = await listOpenReports();
        if (ignore) return;
        setReports(rows);
        // ONE call for every reported cook in the queue, never one per row. public_cooks is
        // a security definer view, which is the only reason a moderator can read these names
        // at all: profiles itself is readable only to its owner.
        const ids = rows.map((r) => r.cook_id).filter((id): id is string => !!id);
        const found = await getPublicCooks(ids).catch(() => new Map<string, PublicCook>());
        if (!ignore) setCooks(found);
      }
      setLoading(false);
    })().catch(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function act(
    r: ReportRow,
    action: "unpublish" | "suspend" | "dismiss" | "clear_name",
  ) {
    await resolveReport(r.id, action, r.reason);
    // Drop the row locally rather than refetching: the only thing that changed is this
    // one report's status, and a refetch would also throw away the moderator's place.
    setReports((prev) => prev.filter((x) => x.id !== r.id));
  }

  if (loading) return <Skeleton shape="plate" count={3} />;

  // The ROUTE checks the flag rather than relying on the nav hiding the link. A hidden
  // link is not a permission: anyone can type the URL, and the nav is one refactor away
  // from showing it to everybody.
  if (!profile?.is_moderator) return <p>Not found</p>;

  return (
    <div>
      <h1>Moderation</h1>

      {/* Six views, not six routes: the console is one page, and a URL per tab would be
          six more router entries for no navigational gain. */}
      <div className="group-toggle">
        <button type="button" aria-pressed={view === "reports"} onClick={() => setView("reports")}>
          Reports
        </button>
        <button type="button" aria-pressed={view === "appeals"} onClick={() => setView("appeals")}>
          Appeals
        </button>
        <button type="button" aria-pressed={view === "recipes"} onClick={() => setView("recipes")}>
          Recipes
        </button>
        <button type="button" aria-pressed={view === "people"} onClick={() => setView("people")}>
          People
        </button>
        <button type="button" aria-pressed={view === "kitchen"} onClick={() => setView("kitchen")}>
          Kitchen
        </button>
        <button type="button" aria-pressed={view === "trail"} onClick={() => setView("trail")}>
          Trail
        </button>
      </div>

      {view === "reports" && (
        <>
          {reports.length === 0 ? (
            <p className="vault-note">No open reports.</p>
          ) : (
            <ul className="report-list">
              {reports.map((r) => (
                <li key={r.id} className="plate panel">
                  {r.cook_id ? (
                    // A cook who has cleared their handle has no public page, so there is nothing
                    // to link to: a link to /cooks/undefined is worse than plain text.
                    cooks.get(r.cook_id)?.handle ? (
                      <Link to={"/cooks/" + cooks.get(r.cook_id)!.handle}>
                        {cooks.get(r.cook_id)!.public_name ?? cooks.get(r.cook_id)!.handle}
                      </Link>
                    ) : (
                      <span>Unknown cook</span>
                    )
                  ) : (
                    <Link to={"/recipes/" + r.recipe_id}>{r.recipes?.title ?? "Untitled"}</Link>
                  )}
                  <p className="vault-note">{REASON_LABELS[r.reason]}</p>
                  {r.note && <p>{r.note}</p>}
                  <div className="recipe-actions">
                    {r.cook_id ? (
                      <>
                        {/* Clear name deliberately leaves the handle alone: the handle is the
                            identity in every /cooks/<handle> URL, so nulling it would break
                            every link to this cook. Only the display name is the impersonation. */}
                        <button type="button" onClick={() => act(r, "clear_name")}>Clear name</button>
                        <button type="button" onClick={() => act(r, "suspend")}>Suspend cook</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => act(r, "unpublish")}>Unpublish</button>
                        <button type="button" onClick={() => act(r, "suspend")}>Suspend cook</button>
                      </>
                    )}
                    <button type="button" onClick={() => act(r, "dismiss")}>Dismiss</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Mounted only once the moderator switches to it, so the roster's service-role call
          never runs on the page's main job, which is the report queue. */}
      {view === "appeals" && <Appeals />}
      {view === "recipes" && <Overview />}
      {view === "people" && <People />}
      {view === "kitchen" && <KitchenSection />}
      {view === "trail" && <Trail />}
    </div>
  );
}

// What an appeal is against, in words rather than the raw enum. ONE place, because the same
// mapping read inline in three JSX branches is three copies that drift.
const SUBJECT_LABELS: Record<AppealRow["subject_type"], string> = {
  name: "A cleared public name",
  suspension: "A suspension",
  recipe: "A removed recipe",
};

// Where an account came from, in words rather than the raw key. `uncredited` is deliberately
// NOT "direct": that would be a claim about how they arrived, and the bucket also holds
// everyone who signed up before any of this was recorded.
const SOURCE_LABELS: Record<string, string> = {
  hub: "The front page",
  family: "The family page",
  professional: "The professional page",
  uncredited: "Arrived without a credited link",
};

// The family app's own surfaces, in words rather than the raw key. `kitchen` here is the
// family app's MEAL PLANS and has nothing to do with the professional kitchen app, which is
// the whole reason these labels exist: the raw key sitting next to a Kitchen tab reads as
// the other product's numbers.
const SURFACE_LABELS: Record<string, string> = {
  recipes: "Recipes",
  families: "Families",
  potluck: "Potluck",
  kitchen: "Meal plans",
  cupboard: "Cupboard",
  cookmode: "Cook mode",
  drafts: "Drafts",
  settings: "Settings",
  profile: "Profile",
  moderation: "Moderation",
};

function Appeals() {
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [cooks, setCooks] = useState<Map<string, PublicCook>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which row is mid-action, so its buttons can be disabled and its error shown beside it.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The note PER ROW, keyed by appeal id. One shared string would show every row the same
  // text and, worse, send whatever was typed anywhere as the note on whichever appeal was
  // resolved: a note written for one cook arriving on another cook's decision.
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let ignore = false;
    listOpenAppeals()
      .then(async (rows) => {
        if (ignore) return;
        setAppeals(rows);
        // ONE call for every appellant in the queue, never one per row. public_cooks is a
        // security definer view, which is the only reason a moderator can read these names
        // at all: profiles itself is readable only to its owner.
        const found = await getPublicCooks(rows.map((r) => r.cook_id)).catch(
          () => new Map<string, PublicCook>(),
        );
        if (!ignore) setCooks(found);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ignore) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function resolve(a: AppealRow, outcome: "granted" | "declined") {
    setBusyId(a.id);
    setRowError(null);
    try {
      // Granting is what performs the undo, and the database does that inside
      // resolve_appeal, so this component never touches profiles or recipes itself.
      await resolveAppeal(a.id, outcome, notes[a.id] ?? "");
      // Drop the row locally rather than refetching: the only thing that changed is this
      // one appeal's resolution, and a refetch would also throw away the moderator's place.
      setAppeals((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      // The row stays: a failed resolve must not read as a resolved one.
      setRowError({ id: a.id, message: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Skeleton shape="plate" count={3} />;
  // A failed load shows its own message and nothing else, so it can never blank the page.
  if (error) return <p className="form-error">{error}</p>;
  if (appeals.length === 0) return <p className="vault-note">No open appeals.</p>;

  return (
    <ul className="report-list">
      {appeals.map((a) => (
        <li key={a.id} className="plate panel">
          {cooks.get(a.cook_id)?.handle ? (
            // A cook who has cleared their handle has no public page, so there is nothing to
            // link to: a link to /cooks/undefined is worse than plain text.
            <Link to={"/cooks/" + cooks.get(a.cook_id)!.handle}>
              {cooks.get(a.cook_id)!.public_name ?? cooks.get(a.cook_id)!.handle}
            </Link>
          ) : (
            <span>Unknown cook</span>
          )}
          <p className="vault-note">
            {SUBJECT_LABELS[a.subject_type]}
            {a.subject_type === "recipe" && a.subject_id && (
              <>
                {": "}
                <Link to={"/recipes/" + a.subject_id}>{a.recipes?.title ?? "Untitled"}</Link>
              </>
            )}
          </p>
          <p>{a.body}</p>
          <div className="recipe-actions">
            <input
              aria-label={"Note for " + (cooks.get(a.cook_id)?.public_name
                ?? cooks.get(a.cook_id)?.handle ?? "this cook")}
              placeholder="Note (optional)"
              value={notes[a.id] ?? ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
            />
            <button type="button" disabled={busyId === a.id} onClick={() => resolve(a, "granted")}>
              Grant
            </button>
            <button type="button" disabled={busyId === a.id} onClick={() => resolve(a, "declined")}>
              Decline
            </button>
          </div>
          {/* The backend's refusal text is the useful part, so it is shown verbatim beside
              the row rather than swallowed. */}
          {rowError?.id === a.id && <p className="form-error">{rowError.message}</p>}
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [insights, setInsights] = useState<AdminInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error` on purpose: a failed insights load must not blank the tiles and
  // the chart above it, and a failed stats load must not blank the four panels below.
  const [insightsError, setInsightsError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getAdminStats()
      .then((s) => { if (!ignore) setStats(s); })
      .catch((e: Error) => { if (!ignore) setError(e.message); });
    // An independent call with its own catch, so neither load can take the other down.
    getAdminInsights()
      .then((i) => { if (!ignore) setInsights(i); })
      .catch((e: Error) => { if (!ignore) setInsightsError(e.message); });
    return () => {
      ignore = true;
    };
  }, []);

  // NO EARLY RETURN FOR EITHER FAILURE, and that is the whole point of the two states.
  //
  // This used to be `if (error) return <p>...</p>`, which was correct while the overview was
  // one load: the message replaced the thing that failed. With two independent loads an early
  // return means the FIRST failure blanks the other half as well, so a stats outage would hide
  // four panels that loaded perfectly. Each half now renders its own outcome, and a test pins
  // both directions.
  return (
    <>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !stats ? (
        <Skeleton shape="plate" count={2} />
      ) : (
        <StatsSection stats={stats} />
      )}

      {/* The four insight panels. A failed insights load replaces ONLY these, and a failed
          stats load replaces only the half above: neither can blank the other. */}
      {insightsError ? (
        <p className="form-error">{insightsError}</p>
      ) : !insights ? (
        <Skeleton shape="plate" count={4} />
      ) : (
        <>
          <section className="plate panel">
            <h2>Coming back</h2>
            <ul className="stat-row">
              <InsightTile label="Used it on more than one day" pair={insights.returning.repeat} />
              <InsightTile label="Active in the last 7 days" pair={insights.returning.active7} />
              <InsightTile label="Active in the last 30 days" pair={insights.returning.active30} />
            </ul>
            {/* The most important line in the panel: these counters start empty, so a low
                number here is not a finding about the app, it is an absence of history. */}
            <p className="vault-note">
              {insights.returning.since
                ? `Collecting began on ${shortDay(insights.returning.since)}, so these numbers only mean something once there is a while behind them.`
                : "Nothing has been recorded yet, so these numbers are not low, they are unmeasured."}
            </p>
          </section>

          <section className="plate panel">
            <h2>Onboarding</h2>
            <ul className="stat-row">
              <InsightTile label="Signed up" pair={insights.funnel.signedUp} />
              <InsightTile label="Joined a family" pair={insights.funnel.joinedFamily} />
              <InsightTile label="Saved a recipe" pair={insights.funnel.savedRecipe} />
            </ul>
            {/* One sentence, because the long version already lives on AdminStats. */}
            <p className="vault-note">
              "Signed up" counts profiles rather than logins, so it includes every account ever
              deleted.
            </p>
          </section>

          <section className="plate panel">
            <h2>Features used, last 30 days</h2>
            {/* Every surface is listed, zeros included: a row at zero is information, and
                filtering it out would hide exactly the thing worth seeing. */}
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Surface</th>
                  {/* PEOPLE, not visits. The server counts DISTINCT users per surface, so a
                      cook who opened Potluck every day for a month is one. Labelling this
                      "Uses" would be the exact conflation AdminStats already warns about. */}
                  <th scope="col">People</th>
                </tr>
              </thead>
              <tbody>
                {insights.surfaces.map((s) => (
                  <tr key={s.surface}>
                    {/* Falls back to the raw key, so a new surface cannot render as blank. */}
                    <td>{SURFACE_LABELS[s.surface] ?? s.surface}</td>
                    <td>
                      <PairValue pair={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="plate panel">
            <h2>Where accounts came from</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {insights.sources.map((s) => (
                  <tr key={s.source}>
                    {/* Falls back to the raw key, so a new source cannot render as blank. */}
                    <td>{SOURCE_LABELS[s.source] ?? s.source}</td>
                    <td>
                      <PairValue pair={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

// The professional kitchen app, which is a SEPARATE PRODUCT from the family app: it lives in
// its own `kitchen` schema and shares no data with anything above. It is not deployed yet, so
// every number here is expected to be zero, and the note at the top of the section says so.
// Without it a wall of zeros reads as a bug rather than as an unused product.
//
// The counts are NOT pairs, unlike everything in Overview: there is no moderator concept in
// the kitchen schema, so there is nothing to exclude and no PairValue or InsightTile here.
function KitchenSection() {
  const [insights, setInsights] = useState<KitchenInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getKitchenInsights()
      .then((i) => { if (!ignore) setInsights(i); })
      .catch((e: Error) => { if (!ignore) setError(e.message); });
    return () => {
      ignore = true;
    };
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!insights) return <Skeleton shape="plate" count={3} />;

  const days = lastThirtyDays(insights.orgsByDay);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // The busiest day is the scale, so the tallest bar is always full height. A zero busiest
  // day would divide by zero, so it falls back to 1 and every bar renders flat.
  const busiest = Math.max(1, ...days.map((d) => d.count));

  const counts: [string, number][] = [
    // The throughput figures lead, because they are the only ones that say whether the product
    // WORKS rather than how much of it exists. The median is not among them: it can be null,
    // and a tile is a number or it is a blank space, so it gets a sentence below instead.
    ["Dishes started", insights.throughput.started],
    ["Dishes signed off", insights.throughput.landed],
    ["In development over a month", insights.throughput.slowOverAMonth],
    ["Staff active this week", insights.activeStaff],
    ["Kitchens", insights.counts.orgs],
    ["Venues", insights.counts.sites],
    ["Staff", insights.counts.staff],
    ["Dishes", insights.counts.dishes],
    ["Published", insights.counts.published],
    ["Open invites", insights.counts.openInvites],
  ];

  const funnel: [string, number][] = [
    ["Created a kitchen", insights.funnel.created],
    ["Added a venue", insights.funnel.addedSite],
    ["Added a dish", insights.funnel.addedDish],
    ["Published a dish", insights.funnel.publishedDish],
  ];

  return (
    <>
      {/* THE MOST IMPORTANT LINE IN THE SECTION. A separate product that is not deployed
          yet reports zeros, and zeros with no explanation read as a broken page. */}
      {/* THE MOST IMPORTANT LINE IN THE SECTION, and it said the wrong thing until 2026-10-21.
          It claimed the app was not deployed, which stopped being true on 2026-10-12. The
          numbers are still near zero, and the honest reason is that the app is noindex and
          linked from nowhere, so it has no traffic by design. Both readings excuse a wall of
          zeros; only one of them is true, and the false one would have been quoted back as
          evidence the app was unfinished. */}
      <p className="vault-note">
        The professional kitchen app is a separate product from the family app and shares no
        data with it. It is live, but it is not indexed and nothing links to it, so it has no
        traffic by design: a zero here means nobody has used it, not that anything is broken.
      </p>
      <p className="vault-note">
        {insights.throughput.landed === 0
          ? "No dish has been signed off yet, so there is no median to give."
          : `Across every kitchen, the median dish takes ${insights.throughput.medianDays} days from its first version to sign-off.`}{" "}
        Staff active this week counts people and never names them: an owner sees their own staff
        by name inside the kitchen app, and this console cannot.
      </p>

      <ul className="stat-row">
        {counts.map(([label, value]) => (
          <li key={label} className="plate stat-tile">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </li>
        ))}
      </ul>

      {/* Two counts that look like row counts and are not, so the difference is written down
          rather than left to be inferred from a number that happens to be small. */}
      <p className="vault-note">
        Staff counts PEOPLE, not staff rows: one person can work in more than one kitchen.
        Published counts dishes that are currently published rather than publication events,
        because that table holds one row per dish.
      </p>

      <section className="plate panel">
        <h2>Where a kitchen stops</h2>
        <ul className="stat-row">
          {funnel.map(([label, value]) => (
            <li key={label} className="plate stat-tile">
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
            </li>
          ))}
        </ul>
        {/* Each step is a count of KITCHENS, not of rows: a kitchen that added three venues
            is still one kitchen at that step, so the steps are comparable to each other. */}
        <p className="vault-note">
          Each step counts kitchens, not rows, so a kitchen that added three venues still
          counts once here.
        </p>
      </section>

      <section className="plate panel">
        <h2>Kitchens created, last 30 days</h2>
        {/* role="img" with a summary label: a wall of unlabelled divs says nothing to a
            screen reader, and the individual bars are decoration for the total. */}
        <div
          className="signup-bars"
          role="img"
          aria-label={`${total} kitchens created in the last 30 days`}
        >
          {days.map((d) => (
            <div
              key={d.day}
              className="signup-bar"
              title={`${d.day}: ${d.count}`}
              style={{ height: `${Math.round((d.count / busiest) * 100)}%` }}
            />
          ))}
        </div>
      </section>

      {/* shortDate, NOT shortDay: `newest` is a full timestamptz, and shortDay is for bare
          "YYYY-MM-DD" strings only. */}
      <p className="vault-note">
        {insights.newest
          ? `The most recent kitchen was created on ${shortDate(insights.newest)}.`
          : "No kitchen has been created yet."}
      </p>
    </>
  );
}

// The tiles and the signups chart, extracted when the overview gained a second independent
// load. It takes a non-null stats, so the caller decides what a failure or a pending load
// looks like, and this renders only the success case.
function StatsSection({ stats }: { stats: AdminStats }) {
  const days = lastThirtyDays(stats.signupsByDay);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // The busiest day is the scale, so the tallest bar is always full height. A zero busiest
  // day would divide by zero, so it falls back to 1 and every bar renders flat.
  const busiest = Math.max(1, ...days.map((d) => d.count));

  const tiles: [string, number][] = [
    // Two tiles, not one: see the note on AdminStats. "Users" alone showed the profiles count
    // and read as 6 where there were 3 logins.
    ["Users", stats.users],
    ["Ever joined", stats.everJoined],
    ["Recipes", stats.recipes],
    ["Published", stats.published],
    ["Removed", stats.removed],
    ["Families", stats.families],
    ["Open reports", stats.openReports],
    ["Suspended", stats.suspended],
  ];

  return (
    <>
      <ul className="stat-row">
        {tiles.map(([label, value]) => (
          <li key={label} className="plate stat-tile">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </li>
        ))}
      </ul>

      <section className="plate panel">
        <h2>Signups, last 30 days</h2>
        {/* role="img" with a summary label: a wall of unlabelled divs says nothing to a
            screen reader, and the individual bars are decoration for the total. */}
        <div
          className="signup-bars"
          role="img"
          aria-label={`${total} signups in the last 30 days`}
        >
          {days.map((d) => (
            <div
              key={d.day}
              className="signup-bar"
              title={`${d.day}: ${d.count}`}
              style={{ height: `${Math.round((d.count / busiest) * 100)}%` }}
            />
          ))}
        </div>
      </section>
    </>
  );
}

// ONE treatment for every pair in the console: the total, then the figure that excludes
// moderators beside it. The owner is most of the traffic, so a bare total mostly reports him
// back to himself, and moderators are not excluded outright because his own use is currently
// the only use that finds bugs.
function PairValue({ pair }: { pair: { all: number; others: number } }) {
  return (
    <>
      <span className="stat-value">{pair.all}</span>{" "}
      <span className="vault-note">{pair.others} not counting moderators</span>
    </>
  );
}

// A pair as a stat tile, so the returning and funnel figures read like the tiles above.
function InsightTile({ label, pair }: { label: string; pair: { all: number; others: number } }) {
  return (
    <li className="plate stat-tile">
      <PairValue pair={pair} />
      <span className="stat-label">{label}</span>
    </li>
  );
}

// What each action was, in words rather than the raw key. ONE place, because the same mapping
// read inline in a JSX branch is a copy that drifts. The keys are migration 0066's allowlist and
// this record must gain an entry whenever that constraint does.
const ACTION_LABELS: Record<string, string> = {
  suspend: "Suspended a cook",
  unsuspend: "Lifted a suspension",
  set_moderator: "Made someone a moderator",
  unset_moderator: "Removed a moderator",
  delete_user: "Deleted an account",
  takedown_recipe: "Took a recipe down",
  restore_recipe: "Put a recipe back",
  clear_name: "Cleared a public name",
  restore_name: "Restored a public name",
  dismiss_report: "Dismissed a report",
  grant_appeal: "Granted an appeal",
  decline_appeal: "Declined an appeal",
};

// Which door the action came through. A suspension arrives both ways, and "was this a judgement
// call or a report queue decision" is the first question anyone reviewing the work will ask.
const VIA_LABELS: Record<string, string> = {
  direct: "Directly",
  report: "From a report",
  appeal: "From an appeal",
};

function Trail() {
  const [events, setEvents] = useState<ModerationEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    listModerationEvents(1)
      .then((r) => {
        if (ignore) return;
        setEvents(r.events);
        setHasMore(r.hasMore);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ignore) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function loadMore() {
    const next = page + 1;
    const r = await listModerationEvents(next);
    setEvents((prev) => [...prev, ...r.events]);
    setHasMore(r.hasMore);
    setPage(next);
  }

  if (loading) return <Skeleton shape="plate" count={3} />;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      {/* An empty trail and a quiet month look identical, so the note says which this is. There
          is nothing to backfill from: the first row is the first action after 0066 deployed. */}
      <p className="vault-note">
        Every moderator action since this record began. Nothing before that was kept.
      </p>
      {events.length === 0 ? (
        <p className="vault-note">No moderator action has been taken yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">To whom</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{shortDate(e.at)}</td>
                <td>{e.actorName ?? "A former moderator"}</td>
                <td>
                  {ACTION_LABELS[e.action] ?? e.action}
                  <span className="vault-note"> {VIA_LABELS[e.via] ?? e.via}</span>
                </td>
                <td>{e.subjectName ?? (e.subjectRecipe ? "A recipe" : "")}</td>
                <td>{e.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <button type="button" onClick={loadMore}>
          Load more
        </button>
      )}
    </>
  );
}

function People() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Comes from the roster call, because only the edge function knows it.
  const [callerIsOwner, setCallerIsOwner] = useState(false);
  // 1-based, because the admin function's `users` action is: it clamps anything below 1
  // to page 1. Starting at 0 made the first Load more re-request page 1 and append a
  // duplicate of everyone already on screen.
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Which row is mid-action, so its buttons can be disabled and its error shown beside it.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The row whose inline suspend form is open, and the reason typed into it.
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // The row whose delete confirmation is open, and the word typed to arm it.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState("");

  // Refetch from the server rather than patching the row locally: the roster is a
  // service-role view of the database, and a local patch would show a state the database
  // does not hold (a suspension that failed, a moderator flag that was refused).
  async function refresh() {
    const first = await listAdminUsers(1);
    setUsers(first.users);
    setHasMore(first.hasMore);
    setCallerIsOwner(first.callerIsOwner);
    setPage(1);
  }

  useEffect(() => {
    let ignore = false;
    listAdminUsers(1)
      .then((r) => {
        if (ignore) return;
        setUsers(r.users);
        setHasMore(r.hasMore);
        setCallerIsOwner(r.callerIsOwner);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ignore) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function loadMore() {
    const next = page + 1;
    const r = await listAdminUsers(next);
    setUsers((prev) => [...prev, ...r.users]);
    setHasMore(r.hasMore);
    setPage(next);
  }

  // Every action funnels through here so the busy flag, the error placement and the
  // refresh-on-success rule are written once. On failure the roster is left untouched.
  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    try {
      await fn();
      await refresh();
      setSuspendId(null);
      setDeleteId(null);
      setReason("");
      setConfirmWord("");
    } catch (e) {
      setRowError({ id, message: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? users.filter((u) =>
        [u.displayName, u.handle, u.email].some((v) => v?.toLowerCase().includes(needle)),
      )
    : users;

  if (loading) return <Skeleton shape="plate" count={3} />;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      <div className="vault-tools">
        {/* aria-label, not a placeholder: a placeholder is not a label, and the filter is
            the only control above the table. */}
        <input
          type="search"
          aria-label="Filter people by name, handle or email"
          placeholder="Filter by name, handle or email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Email</th>
            <th scope="col">Joined</th>
            <th scope="col">Last seen</th>
            <th scope="col">Recipes</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id}>
              <td>
                {u.displayName ?? "Unnamed"}
                {u.handle && (
                  <>
                    {" "}
                    <Link to={"/cooks/" + u.handle}>@{u.handle}</Link>
                  </>
                )}
              </td>
              <td>
                {u.email ?? "-"}
                {!u.emailConfirmed && " unconfirmed"}
                {u.provider && u.provider !== "email" && " (" + u.provider + ")"}
              </td>
              <td>{shortDate(u.createdAt)}</td>
              <td>{shortDate(u.lastSignInAt)}</td>
              <td>{u.recipes}</td>
              <td>
                {u.suspendedAt
                  ? "Suspended" + (u.suspendedReason ? ": " + u.suspendedReason : "")
                  : u.isModerator
                    ? "Moderator"
                    : "Active"}
              </td>
              <td>
                <div className="recipe-actions">
                  {u.suspendedAt ? (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => run(u.id, () => unsuspendUser(u.id))}
                    >
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => {
                        setSuspendId(suspendId === u.id ? null : u.id);
                        setReason("");
                        setRowError(null);
                      }}
                    >
                      Suspend
                    </button>
                  )}
                  {/* Only the owner may change who moderates (0066), so a plain moderator is
                      not shown a button the function would refuse. The refusal is still in the
                      function: this is about not drawing a dead control. */}
                  {callerIsOwner && (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => run(u.id, () => setModerator(u.id, !u.isModerator))}
                    >
                      {u.isModerator ? "Remove moderator" : "Make moderator"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => {
                      setDeleteId(deleteId === u.id ? null : u.id);
                      setConfirmWord("");
                      setRowError(null);
                    }}
                  >
                    Delete
                  </button>
                </div>

                {/* A typed reason, not window.prompt: the backend rejects an empty one and
                    the reason is shown to the person, so it has to be a real field. */}
                {suspendId === u.id && (
                  <form
                    className="inline-confirm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(u.id, () => suspendUser(u.id, reason.trim()));
                    }}
                  >
                    <label>
                      Reason for suspending {u.displayName ?? u.email ?? "this person"}
                      <input value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <button
                      type="submit"
                      className="action"
                      disabled={!reason.trim() || busyId === u.id}
                    >
                      Confirm suspend
                    </button>
                  </form>
                )}

                {/* Delete is irreversible, so the confirming button stays disabled until the
                    word is typed. The typed word is the deliberate act, not the click. */}
                {deleteId === u.id && (
                  <form
                    className="inline-confirm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(u.id, () => deleteUserAccount(u.id));
                    }}
                  >
                    <label>
                      Type DELETE to confirm deleting {u.displayName ?? u.email ?? "this person"}
                      <input
                        value={confirmWord}
                        onChange={(e) => setConfirmWord(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="action"
                      disabled={confirmWord !== "DELETE" || busyId === u.id}
                    >
                      Confirm delete
                    </button>
                  </form>
                )}

                {/* The backend's refusal text is the useful part (it names the reason), so it
                    is shown verbatim beside the row rather than swallowed. */}
                {rowError?.id === u.id && <p className="form-error">{rowError.message}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown.length === 0 && <p className="vault-note">Nobody matches that filter.</p>}

      {hasMore && (
        <button type="button" className="action" onClick={loadMore}>
          Load more
        </button>
      )}
    </>
  );
}
