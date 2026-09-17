export type Visibility = "private" | "family" | "public";
export interface Profile { id: string; display_name: string; avatar_url: string | null; }
export interface Family { id: string; name: string; invite_code: string; created_by: string; }
export interface FamilyMember { family_id: string; user_id: string; role: "owner" | "member"; }
export interface Ingredient { id?: string; position: number; quantity: string | null; unit: string | null; item: string; }
export interface Step { id?: string; position: number; text: string; }
export interface Recipe {
  id: string; family_id: string; author_id: string; title: string;
  story: string | null; provenance: string | null; servings: number | null;
  prep_minutes: number | null; cook_minutes: number | null;
  visibility: Visibility; source_url: string | null; created_at: string; updated_at: string;
}
export interface RecipePhoto { id: string; recipe_id: string; storage_path: string; is_cover: boolean; }
export interface Comment { id: string; recipe_id: string; author_id: string; body: string; created_at: string; }
export interface Tag { id: string; family_id: string; name: string; }
// what the AI returns and the create form binds to (no ids, no server fields)
export interface RecipeDraft {
  title: string; story: string; provenance: string;
  servings: number | null; prep_minutes: number | null; cook_minutes: number | null;
  ingredients: Ingredient[]; steps: Step[]; source_url: string | null;
}
