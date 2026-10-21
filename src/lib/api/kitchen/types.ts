// The professional kitchen's own types. They deliberately share NOTHING with ./types.ts one
// directory up: a dish is not a recipe, and a staff member is not a family member. Two types
// that look alike today and diverge tomorrow are worse than two separate ones.
export type StaffRole = "owner" | "chef" | "site_manager" | "cook";

export type Org = { id: string; name: string };
// closed_at is set when the site was closed.
export type Site = { id: string; org_id: string; name: string; closed_at: string | null };

// site_id null means GROUP-WIDE. For an owner or a chef that is normal. For a site_manager or
// a cook it means they belong to no site, and the database's read ladder then shows them
// nothing until a dish reaches the menu.
export type StaffMember = {
  user_id: string;
  role: StaffRole;
  site_id: string | null;
  display_name: string;
};

export type Invite = { org_name: string; role: StaffRole; site_name: string | null };

export type DishStage = "development" | "trial" | "menu";

export type Dish = {
  id: string;
  org_id: string;
  title: string;
  stage: DishStage;
  // Set only while the dish is at trial, and the database has a constraint saying so.
  trial_site_id: string | null;
  // Set when the dish was retired. A retired dish is refused by send_to_trial and sign_off;
  // publishing stays available on purpose.
  retired_at: string | null;
};

// `n` counts up from 1 per dish. A version is IMMUTABLE: revising writes a new one, which is
// what makes "who changed what and why" answerable.
export type DishVersion = {
  id: string;
  n: number;
  note: string | null;
  // Null once that person has deleted their account: 0059 made every attribution column in
  // this schema `on delete set null`, because a foreign key to auth.users with no on-delete
  // action REFUSES the deletion outright.
  created_by: string | null;
  created_at: string;
};

export type DishIngredient = {
  position: number;
  quantity: string | null;
  unit: string | null;
  item: string;
  section: string | null;
};

export type DishStep = { position: number; text: string };

export type Deviation = {
  id: string;
  site_id: string;
  note: string;
  created_at: string;
};

// A dish that has been in development for over a month without being signed off. `days` is
// counted from its FIRST version, because that is when the work started.
export type SlowDish = { id: string; title: string; days: number };

// One site as the numbers page sees it. `trials` is the dishes on trial there NOW, not ever,
// and `last_recorded` is the newest deviation, which is the only history a site keeps.
export type SiteNumbers = {
  id: string;
  name: string;
  substitutions: number;
  trials: number;
  last_recorded: string | null;
  added: string;
  closed: boolean;
};

// The whole answer from kitchen.group_numbers, mirroring its jsonb keys exactly. Every figure
// is all-time, so a quiet month cannot move the headline number.
export type GroupNumbers = {
  dishes: { started: number; landed: number; median_days: number | null; slow: SlowDish[] };
  funnel: {
    dishes: number;
    with_version: number;
    trialled: number;
    landed: number;
    on_menu: number;
  };
  sites: SiteNumbers[];
};

// The three figures the dashboard strip shows, keyed by org id in my_group_numbers.
export type StripNumbers = { started: number; landed: number; median_days: number | null };

// One person as the owner-only people block sees them. `days_back` is out of `of_days`, and
// the denominator is whatever the database sent: it is never assumed to be a week.
// `never` is true when they have not opened the app at all, and `last_seen` is null then.
export type StaffAttendance = {
  user_id: string;
  display_name: string;
  role: string;
  site_name: string | null;
  days_back: number;
  of_days: number;
  last_seen: string | null;
  never: boolean;
};

// The whole answer from kitchen.group_people, mirroring its jsonb keys exactly.
export type GroupPeople = {
  staff: StaffAttendance[];
  invites: { issued: number; used: number; open: number; aged_out: number };
  closed_sites: number;
  retired_dishes: number;
};

// unpublished_at is what says whether the dish is public RIGHT NOW. The row survives a
// takedown on purpose: it holds the recipe id, so re-publishing reuses the same public URL
// and a link somebody already sent keeps working.
export type Snapshot = {
  recipe_id: string;
  version_id: string;
  published_at: string;
  unpublished_at: string | null;
};
