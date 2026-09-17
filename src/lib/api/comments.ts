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

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
