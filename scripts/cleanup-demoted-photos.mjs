// One-off cleanup for photos left behind by the OLD replace behaviour.
//
// Before 9b1aec3, replacing a recipe's cover demoted the previous row to is_cover = false
// instead of deleting it. Those rows are invisible (every reader orders by is_cover desc and
// takes the first row, so a recipe with a cover never shows them) but the stored file is still
// there and still paid for. New replacements delete properly; this clears the backlog.
//
// Dry run by default. Nothing is deleted without --delete.
//
//   node scripts/cleanup-demoted-photos.mjs
//   node scripts/cleanup-demoted-photos.mjs --delete
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Service role, because
// the RLS policies grant deletion to each recipe's AUTHOR and a maintenance sweep is nobody's
// session. Keep the key out of the shell history and out of this repo.
//
// Not written as a migration on purpose: a migration can only delete the storage.objects ROW,
// which leaves the actual file unreferenced and still stored. Only the Storage API removes both.
import { createClient } from "@supabase/supabase-js";

// A row is safe to delete only if its recipe still has a cover. A recipe whose ONLY row is
// is_cover = false is DISPLAYING that photo (the readers just take the first row), so deleting
// it would destroy a visible picture. Exported and tested, because getting this wrong is not
// something a dry run would show you.
//
// AND ONLY IF ITS PATH BELONGS TO ITS OWN RECIPE. This script runs with the service role,
// which is precisely the identity the storage policies do not apply to: everywhere else in
// this app, `storage_path` is resolved through the Storage API, where a cook can only touch a
// folder named after a recipe they wrote. Here it is handed straight to `.remove()`.
//
// Until migration 0057 nothing constrained the column. `photo_write` checks the row's
// `recipe_id` and says nothing about its `storage_path`, and `recipe_photos` is readable for
// any public recipe, so a cook could add a non-cover row to a recipe of their own that already
// has a cover, name a STRANGER'S photo in it, and have this sweep delete that stranger's file.
// 0057 makes such a row unwritable. This check stays anyway, and is not belt and braces: it is
// the half that covers a row written BEFORE that constraint existed, which is exactly the
// backlog this script was written to walk.
const belongsToItsRecipe = (r) =>
  typeof r.storage_path === "string" && r.storage_path.startsWith(`${r.recipe_id}/`);

export function pickDeletable(rows) {
  const hasCover = new Set(rows.filter((r) => r.is_cover).map((r) => r.recipe_id));
  return rows.filter((r) => !r.is_cover && hasCover.has(r.recipe_id) && belongsToItsRecipe(r));
}

// Reported separately rather than silently skipped: a row pointing outside its own recipe is
// either corruption or somebody aiming this script at a file they do not own, and both are
// things the operator should see rather than a line that quietly does not appear.
export function pickForeign(rows) {
  return rows.filter((r) => !r.is_cover && !belongsToItsRecipe(r));
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
    process.exit(1);
  }
  const doDelete = process.argv.includes("--delete");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await db.from("recipe_photos").select("id,recipe_id,storage_path,is_cover");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const deletable = pickDeletable(rows);

  const orphanRecipes = [...new Set(rows.filter((r) => !r.is_cover).map((r) => r.recipe_id))]
    .filter((id) => !rows.some((r) => r.recipe_id === id && r.is_cover));

  console.log(`${rows.length} photo rows, ${rows.filter((r) => r.is_cover).length} covers.`);
  console.log(`${deletable.length} demoted leftovers to remove:`);
  for (const r of deletable) console.log(`  ${r.recipe_id}  ${r.storage_path}`);
  const foreign = pickForeign(rows);
  if (foreign.length > 0) {
    console.log(`\nREFUSING ${foreign.length} row(s) whose path is not inside their own recipe:`);
    for (const r of foreign) console.log(`  ${r.recipe_id}  ${r.storage_path}  <- NOT this recipe's file`);
    console.log("  Nothing here will be deleted. Investigate these before anything else.");
  }
  if (orphanRecipes.length > 0) {
    console.log(`\nSKIPPING ${orphanRecipes.length} recipe(s) whose only photo is non-cover:`);
    for (const id of orphanRecipes) console.log(`  ${id}  <- this photo IS being displayed`);
  }
  if (deletable.length === 0) return console.log("\nNothing to do.");
  if (!doDelete) return console.log("\nDry run. Re-run with --delete to actually remove these.");

  // FILES FIRST here, which is the REVERSE of uploadRecipePhoto, and deliberately so. In the
  // app the row must go first, because a row pointing at a deleted file renders as a broken
  // image. In a sweep the row is the only record of WHICH file to remove, so losing it first
  // would strand the file permanently with no way left to find it. These rows are invisible,
  // so a row briefly outliving its file harms nothing and the script can just be re-run.
  const { error: rmErr } = await db.storage.from("recipe-photos")
    .remove(deletable.map((r) => r.storage_path));
  if (rmErr) throw new Error(`storage removal failed, no rows touched: ${rmErr.message}`);

  const { error: delErr } = await db.from("recipe_photos").delete().in("id", deletable.map((r) => r.id));
  if (delErr) throw new Error(`files removed but rows remain, safe to re-run: ${delErr.message}`);

  console.log(`\nRemoved ${deletable.length} leftover photo(s), files and rows.`);
}

// Importable for the test without running the sweep.
if (process.argv[1] && process.argv[1].endsWith("cleanup-demoted-photos.mjs")) await main();
