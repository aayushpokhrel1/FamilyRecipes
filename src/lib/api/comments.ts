import { supabase } from "../supabaseClient";
import type { Comment } from "./types";

export type CommentWithAuthor = Comment & { profiles: { display_name: string } | null };

export async function listComments(recipeId: string): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase.from("comments")
    .select("*, profiles(display_name)").eq("recipe_id", recipeId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as CommentWithAuthor[];
}

export async function addComment(recipeId: string, body: string): Promise<Comment> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("comments")
    .insert({ recipe_id: recipeId, author_id: user.user.id, body }).select().single();
  if (error) throw new Error(error.message);
  return data as Comment;
}

// .select("id") for the reason updateRecipe does it: A REFUSED DELETE IS NOT AN ERROR.
// comments_delete admits the author alone while comments_read admits every member of the
// family, so deleting someone else's comment matched no rows and resolved, and the thread
// simply redrew with the comment still in it.
export async function deleteComment(id: string): Promise<void> {
  const { data, error } = await supabase.from("comments").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Only the person who wrote a comment can delete it.");
}
