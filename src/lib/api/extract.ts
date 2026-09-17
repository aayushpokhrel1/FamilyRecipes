import { supabase } from "../supabaseClient";
import type { RecipeDraft } from "./types";

export async function extractRecipe(
  mode: "text" | "url" | "image" | "audio",
  payload: string
): Promise<RecipeDraft> {
  const { data, error } = await supabase.functions.invoke("extract-recipe", {
    body: { mode, payload },
  });
  if (error) throw new Error(error.message);
  return data as RecipeDraft;
}
