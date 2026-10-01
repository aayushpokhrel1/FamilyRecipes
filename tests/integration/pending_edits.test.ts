// @vitest-environment node
// The DB half of pending edits: publishing a draft onto a LIVE recipe. The recipe is on
// screen for other people while the draft sits there, so the two things that matter are that
// a publish replaces the recipe's children rather than appending to them, and that a recipe
// which moved underneath the draft is refused rather than silently overwritten.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);

// A cook, their own family with an owner membership, and a recipe in it. Every test needs
// all three, and the membership is what makes recipes_update allow the publish.
async function cookWithRecipe(prefix: string, visibility = "family") {
  const cook = await makeUser(`${prefix}-${stamp()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: `Edits${stamp()}`, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `R${stamp()}`, visibility })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

// An edit draft against an existing recipe, with base_updated_at set to the recipe's
// updated_at as it is right now, which is what "started the edit" means.
async function editDraft(
  cook: { id: string; client: any },
  fam: { id: string },
  rec: { id: string; updated_at: string },
  body: Record<string, unknown>,
) {
  const { data, error } = await cook.client.from("recipe_drafts")
    .insert({
      author_id: cook.id, target_family_id: fam.id, target_recipe_id: rec.id,
      title: "Edited title", body, base_updated_at: rec.updated_at,
    })
    .select().single();
  expect(error).toBeNull();
  return data!;
}

const body = {
  story: "A story", provenance: "Grandma", servings: 4, prep_minutes: 10, cook_minutes: 20,
  ingredients: [{ quantity: "2", unit: "cup", item: "rice" }],
  steps: [{ text: "Boil" }],
  source_url: "https://example.com/rice",
  visibility: "family",
};

describe("publishing a pending edit", () => {
  it("updates the recipe's title and scalars, replaces its ingredients, and deletes the draft", async () => {
    const { cook, fam, rec } = await cookWithRecipe("pe-clean");
    // The recipe already has an ingredient, so "replaced" is distinguishable from "appended
    // to" and from "left alone".
    await admin.from("recipe_ingredients")
      .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: null, item: "old rice" });
    const draft = await editDraft(cook, fam, rec, body);

    const { data: published, error } = await cook.client.rpc("publish_recipe_edit", {
      p_draft: draft.id,
    });
    expect(error).toBeNull();
    expect(published).toBe(rec.id);

    const { data: after } = await admin.from("recipes")
      .select("title,story,provenance,servings,prep_minutes,cook_minutes,source_url,visibility")
      .eq("id", rec.id).single();
    expect(after!.title).toBe("Edited title");
    expect(after!.story).toBe("A story");
    expect(after!.provenance).toBe("Grandma");
    expect(after!.servings).toBe(4);
    expect(after!.prep_minutes).toBe(10);
    expect(after!.cook_minutes).toBe(20);
    expect(after!.source_url).toBe("https://example.com/rice");
    expect(after!.visibility).toBe("family");

    const { data: ings } = await admin.from("recipe_ingredients")
      .select("position,quantity,unit,item").eq("recipe_id", rec.id).order("position");
    expect(ings).toEqual([{ position: 0, quantity: "2", unit: "cup", item: "rice" }]);
    const { data: steps } = await admin.from("recipe_steps")
      .select("position,text").eq("recipe_id", rec.id).order("position");
    expect(steps).toEqual([{ position: 0, text: "Boil" }]);

    const { data: drafts } = await admin.from("recipe_drafts").select("id").eq("id", draft.id);
    expect(drafts).toHaveLength(0);
  });

  it("refuses a recipe that changed since the draft was started, and keeps the draft", async () => {
    const { cook, fam, rec } = await cookWithRecipe("pe-stale");
    const draft = await editDraft(cook, fam, rec, body);

    // Someone else published in between. The admin client stands in for the second editor:
    // what matters is that the recipe's updated_at moved, not who moved it.
    await admin.from("recipes")
      .update({ title: "Someone else's title", updated_at: new Date().toISOString() })
      .eq("id", rec.id);

    const { error } = await cook.client.rpc("publish_recipe_edit", { p_draft: draft.id });
    // DRF01 is a custom SQLSTATE. 40001 (serialization_failure) was tried first and HUNG:
    // PostgREST retries that class, so the refusal never arrived. The CODE is the point: the
    // client offers "publish
    // anyway" only for this, so a real failure must not arrive looking like this one.
    expect(error?.code).toBe("DRF01");

    // The half that matters. A refusal that ate the draft would be worse than the overwrite
    // it was protecting against, because the work is gone either way.
    const { data: still } = await admin.from("recipe_drafts").select("id").eq("id", draft.id);
    expect(still).toHaveLength(1);
    const { data: after } = await admin.from("recipes").select("title").eq("id", rec.id).single();
    expect(after!.title).toBe("Someone else's title");
  });

  it("publishes anyway when p_force is true, overwriting the other change", async () => {
    const { cook, fam, rec } = await cookWithRecipe("pe-force");
    const draft = await editDraft(cook, fam, rec, body);
    await admin.from("recipes")
      .update({ title: "Someone else's title", updated_at: new Date().toISOString() })
      .eq("id", rec.id);

    const { error } = await cook.client.rpc("publish_recipe_edit", {
      p_draft: draft.id, p_force: true,
    });
    expect(error).toBeNull();

    const { data: after } = await admin.from("recipes").select("title").eq("id", rec.id).single();
    expect(after!.title).toBe("Edited title");
    const { data: drafts } = await admin.from("recipe_drafts").select("id").eq("id", draft.id);
    expect(drafts).toHaveLength(0);
  });

  it("refuses a draft that is a new recipe rather than an edit", async () => {
    const { cook, fam } = await cookWithRecipe("pe-create");
    const { data: draft } = await cook.client.from("recipe_drafts")
      .insert({ author_id: cook.id, target_family_id: fam.id, title: "Brand new", body })
      .select().single();

    const { error } = await cook.client.rpc("publish_recipe_edit", { p_draft: draft!.id });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/new recipe, not an edit/);
    // And the draft survives, because a create draft is finished by 5a's insert path.
    const { data: still } = await admin.from("recipe_drafts").select("id").eq("id", draft!.id);
    expect(still).toHaveLength(1);
  });

  it("cannot publish a taken-down recipe back to public", async () => {
    // NO code in 0034 implements this. enforce_publish_rules from 0028 is a TRIGGER on
    // recipes, so it fires on the update inside publish_recipe_edit without the function
    // knowing the rule exists. This test is the alarm: if the trigger is ever weakened, or
    // the publish path is ever rewritten to bypass it, this goes green by accident and the
    // takedown stops meaning anything.
    const { cook, fam, rec } = await cookWithRecipe("pe-removed", "public");
    await admin.from("recipes")
      .update({ visibility: "family", removed_at: new Date().toISOString(),
                removed_reason: "offensive" })
      .eq("id", rec.id);
    const { data: fresh } = await admin.from("recipes")
      .select("updated_at").eq("id", rec.id).single();
    const draft = await editDraft(cook, fam, { id: rec.id, updated_at: fresh!.updated_at },
      { ...body, visibility: "public" });

    const { error } = await cook.client.rpc("publish_recipe_edit", { p_draft: draft.id });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/removed/);

    const { data: after } = await admin.from("recipes")
      .select("visibility,removed_at").eq("id", rec.id).single();
    expect(after!.visibility).toBe("family");
    expect(after!.removed_at).not.toBeNull();
  });

  it("shows an anonymous client nothing and lets it publish nothing", async () => {
    const { cook, fam, rec } = await cookWithRecipe("pe-anon");
    const draft = await editDraft(cook, fam, rec, body);

    // anonClient has the anon key and NO session, which is what a stranger on the internet
    // is. The revokes in 0034 are what stop the call, and the row MUST exist for that to
    // mean anything.
    const anon = anonClient();
    const { error } = await anon.rpc("publish_recipe_edit", { p_draft: draft.id });
    expect(error).not.toBeNull();
    const { data: still } = await admin.from("recipe_drafts").select("id").eq("id", draft.id);
    expect(still).toHaveLength(1);
  });
});
