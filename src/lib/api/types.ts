export type Visibility = "private" | "family" | "public";
export interface Preferences {
  householdSize?: number;
  defaultTab?: "recipes" | "kitchen";
  defaultPlanLength?: number;
  units?: "metric" | "imperial";
}
export interface Profile {
  id: string; display_name: string; avatar_url: string | null;
  // every field is optional: a profile created before the column existed reads back as {}
  preferences: Preferences;
  // null handle means "I do not publish". It IS the opt-in.
  handle: string | null; public_name: string | null; bio: string | null;
  is_moderator: boolean;
  terms_accepted_at: string | null;
  terms_version: string | null;
  // set by a moderator clearing a public_name that impersonated someone: see 0030. The
  // handle is deliberately left alone, so these two are the only trace of the remedy.
  name_cleared_at: string | null;
  name_cleared_reason: string | null;
}
export interface PublicCook {
  id: string; handle: string; public_name: string | null;
  bio: string | null; avatar_url: string | null;
}
export interface Byline {
  handle: string | null; public_name: string | null; family_name: string;
}
export interface Family { id: string; name: string; invite_code: string; created_by: string; }
// A family I belong to, carrying MY role in it. Role lives on family_members, not on
// families, so it does not belong on Family itself. The UI needs it to know whether to offer
// Edit and Delete, which recipes_update and recipes_delete allow to the author OR a family
// owner. Anything that renders those controls must use this, not Family.
export interface MyFamily extends Family { role: "owner" | "member"; }
export interface FamilyMember { family_id: string; user_id: string; role: "owner" | "member"; }
export interface Ingredient { id?: string; position: number; quantity: string | null; unit: string | null; item: string; section?: string | null; optional?: boolean; alt_group?: string | null; }
export interface Step { id?: string; position: number; text: string; }
export interface Recipe {
  id: string; family_id: string; author_id: string; title: string;
  story: string | null; provenance: string | null; servings: number | null;
  prep_minutes: number | null; cook_minutes: number | null;
  visibility: Visibility; source_url: string | null; created_at: string; updated_at: string;
  source_recipe_id: string | null;
  source_cook_name: string | null;
  adapted_at: string | null;
  removed_at: string | null;
  removed_reason: string | null;
}
export type ReportReason =
  | "not_a_recipe" | "offensive" | "not_theirs" | "impersonation" | "other";
// The five labels live here ONCE. The report form and the removed banner both read them,
// and a second copy is how the two drift apart.
export const REASON_LABELS: Record<ReportReason, string> = {
  not_a_recipe: "Not a recipe",
  offensive: "Offensive",
  not_theirs: "Not theirs to publish",
  impersonation: "Impersonation",
  other: "Something else",
};
export type Report = {
  id: string;
  // A report names exactly ONE target: a recipe or a cook, never both and never neither.
  // The database enforces it with num_nonnulls(recipe_id, cook_id) = 1, so both are
  // nullable here and the pair is the invariant.
  recipe_id: string | null;
  cook_id: string | null;
  reporter_id: string;
  reason: ReportReason;
  note: string | null;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
};
// A report as the moderator queue reads it: the embedded recipe title comes back from
// PostgREST's `recipes(title)` select, and is null when the recipe is gone. There is NO cook
// embed: profiles is readable only to its owner, so an embed would be null for every cook
// report. The queue resolves a reported cook through public_cooks instead.
export type ReportRow = Report & { recipes: { title: string } | null };
// A mute or a block. One table with a kind, not two: they differ in what they DO, not in
// what they are. RLS keeps every row private to the blocker, so this is never read for
// anyone else.
export type Block = {
  blocker_id: string;
  blocked_id: string;
  kind: "mute" | "block";
  created_at: string;
};
export interface RecipePhoto { id: string; recipe_id: string; storage_path: string; is_cover: boolean; }
export interface Comment { id: string; recipe_id: string; author_id: string; body: string; created_at: string; }
export interface Tag { id: string; family_id: string; name: string; }
// what the AI returns and the create form binds to (no ids, no server fields)
export interface RecipeDraft {
  title: string; story: string; provenance: string;
  servings: number | null; prep_minutes: number | null; cook_minutes: number | null;
  ingredients: Ingredient[]; steps: Step[]; source_url: string | null;
}
// A SavedDraft is a ROW. RecipeDraft above is FORM STATE held in memory, and the AI
// extraction returns one of those. A SavedDraft CONTAINS a RecipeDraft as its body. The
// two names are one letter apart in meaning and will be conflated by anyone who does not
// read this, which is why the distinction is written here and not in a doc.
export interface SavedDraft {
  id: string; author_id: string; target_family_id: string;
  // null means this is a 5a CREATE draft, a recipe that does not exist yet. A non-null id
  // means it is an EDIT draft for that recipe, which is the only thing that tells the two
  // apart, so anything that renders or resumes a draft branches on this and not on a guess.
  target_recipe_id: string | null;
  draft: RecipeDraft; visibility: Visibility; created_at: string; updated_at: string;
  // the target recipe's updated_at when the edit was started, so publishing can tell whether
  // the recipe moved underneath the draft. null for a create draft, which has no recipe.
  base_updated_at: string | null;
}
export type MealPlanViewMode = "list" | "calendar";
export type MealSlot = "breakfast" | "lunch" | "dinner";
export interface MealPlan {
  id: string; owner_id: string; family_id: string; name: string;
  view_mode: MealPlanViewMode; is_shared: boolean; checked_items: string[];
  // null start_date = an open-ended plan (a trip, a someday list) rather than a week.
  start_date: string | null; length_days: number;
  created_at: string; updated_at: string;
}
export interface MealPlanItem {
  id: string; plan_id: string; recipe_id: string;
  day: string | null; meal_slot: MealSlot | null; position: number;
  servings: number | null;
  // set when this slot is eating an earlier item's pot again, so it buys nothing
  leftover_of: string | null;
}
export interface UpcomingItem {
  id: string; day: string; meal_slot: MealSlot | null; servings: number | null;
  recipe: { id: string; title: string; servings: number | null };
  plan: { id: string; name: string };
  isLeftover: boolean; readOnly: boolean;
}
export interface ManualItem { id: string; label: string; position: number; }
export interface CookEntry { id: string; recipe_id: string; cooked_by: string; cooked_at: string; }
export interface NotCookedLately { recipe: { id: string; title: string }; lastCooked: string | null; }
export interface GroceryContribution {
  quantity: string | null; unit: string | null; recipeTitle: string; scaled: boolean;
}
export interface GroceryLine {
  key: string; name: string; contributions: GroceryContribution[];
  checked: boolean; manual: boolean;
  totals: { quantity: string; unit: string }[];
  partial: boolean;
  // the family always keeps this in, so it is flagged rather than dropped
  staple: boolean;
  // which aisle this line belongs to, derived from the item name. null when the
  // catalog has not seen it, and always null for a manual line.
  category: string | null;
  // true only when EVERY recipe contributing to this line marked it optional
  optional: boolean;
}
