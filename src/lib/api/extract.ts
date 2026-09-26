import { supabase } from "../supabaseClient";
import type { RecipeDraft } from "./types";

// supabase-js collapses EVERY non-2xx from a function into the same string, "Edge Function
// returned a non-2xx status code", and hides the function's own response in error.context.
// That response body is the only thing that tells a rate limit apart from a refused image or
// a model that returned nothing, so surfacing the generic message sends you looking in the
// wrong place. The function always answers with { error: "<what went wrong>" }.
async function describeFunctionError(error: Error): Promise<string> {
  const response = (error as Error & { context?: unknown }).context;
  if (!(response instanceof Response)) return error.message;
  try {
    const body: unknown = await response.clone().json();
    const detail = (body as { error?: unknown })?.error;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // Not JSON. Fall through to the raw text, which still beats the generic message.
  }
  try {
    const text = await response.clone().text();
    if (text) return text;
  } catch {
    // Body already consumed or unreadable; nothing better to offer.
  }
  return error.message;
}

export async function extractRecipe(
  mode: "text" | "url" | "image" | "audio",
  payload: string
): Promise<RecipeDraft> {
  const { data, error } = await supabase.functions.invoke("extract-recipe", {
    body: { mode, payload },
  });
  if (error) throw new Error(await describeFunctionError(error));
  return data as RecipeDraft;
}
