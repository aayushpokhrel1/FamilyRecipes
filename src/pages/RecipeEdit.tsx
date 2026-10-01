import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getRecipe, updateRecipe, listFamilyIngredientNames, listFamilySectionNames } from "../lib/api/recipes";
import { getDraft, saveEditDraft, publishEdit } from "../lib/api/drafts";
import { getRecipeTagIds, setRecipeTags } from "../lib/api/tags";
import { uploadRecipePhoto } from "../lib/api/photos";
import { reportError } from "../lib/api/errorLog";
import type { RecipeDraft, Visibility } from "../lib/api/types";
import { mergeDraft } from "../lib/mergeDraft";
import AiPrefillPanel from "../components/AiPrefillPanel";
import IngredientEditor from "../components/IngredientEditor";
import StepEditor from "../components/StepEditor";
import TagPicker from "../components/TagPicker";
import VisibilitySelect from "../components/VisibilitySelect";
import Skeleton from "../components/Skeleton";

function toNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

export default function RecipeEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("family");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [itemSuggestions, setItemSuggestions] = useState<string[]>([]);
  const [sectionSuggestions, setSectionSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draft"));
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // The recipe's updated_at as it was when this page loaded it. It is what the draft records
  // as its base, and publishing compares it against the recipe's current value to tell whether
  // someone else published in between.
  const [baseUpdatedAt, setBaseUpdatedAt] = useState("");
  // Set when publishing was refused because the recipe moved. It holds the message on screen
  // with the two choices rather than navigating away, because navigating would look like the
  // publish worked and the cook would never learn their edit was not applied.
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
    getRecipe(id)
      .then(({ recipe, ingredients, steps }) => {
        if (ignore) return;
        setDraft({
          title: recipe.title,
          story: recipe.story ?? "",
          provenance: recipe.provenance ?? "",
          servings: recipe.servings,
          prep_minutes: recipe.prep_minutes,
          cook_minutes: recipe.cook_minutes,
          ingredients,
          steps,
          source_url: recipe.source_url,
        });
        setVisibility(recipe.visibility);
        setFamilyId(recipe.family_id);
        setBaseUpdatedAt(recipe.updated_at);
        return getRecipeTagIds(id).then((ids) => {
          if (!ignore) setTagIds(ids);
        });
      })
      .catch((err) => {
        if (ignore) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  // A draft id in the query string means the cook came here to finish that draft, so the form
  // is filled from it. A load that fails reports and says so: leaving the recipe's own values
  // on screen would look exactly like a resumed draft and quietly lose the edit.
  useEffect(() => {
    const savedId = searchParams.get("draft");
    if (!savedId) return;
    getDraft(savedId)
      .then((saved) => {
        setDraft(saved.draft);
        setVisibility(saved.visibility);
      })
      .catch((err) => {
        reportError("load:draft", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [searchParams]);

  useEffect(() => {
    if (familyId) {
      listFamilyIngredientNames(familyId).then(setItemSuggestions).catch(() => setItemSuggestions([]));
      listFamilySectionNames(familyId).then(setSectionSuggestions).catch(() => setSectionSuggestions([]));
    }
  }, [familyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id || !draft) return;
    setError(null);
    try {
      // A resumed edit draft publishes through the RPC, which is what compares the recipe's
      // updated_at against the draft's base and refuses when someone else got there first.
      // Without a draft id this is the plain edit path, unchanged.
      if (draftId) {
        await publishEdit(draftId);
      } else {
        await updateRecipe(id, { ...draft, visibility });
      }
      await setRecipeTags(id, tagIds);
      if (coverFile) await uploadRecipePhoto(id, coverFile, true);
      navigate("/recipes/" + id);
    } catch (err) {
      // The recipe moved underneath the draft. This is not a failure to report and not a
      // reason to navigate: the cook is shown what happened and chooses.
      if (err instanceof Error && err.name === "RecipeMoved") {
        setMoved(true);
        return;
      }
      reportError("save:recipe-edit", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePublishAnyway() {
    if (!id || !draftId) return;
    setError(null);
    try {
      await publishEdit(draftId, true);
      await setRecipeTags(id, tagIds);
      if (coverFile) await uploadRecipePhoto(id, coverFile, true);
      navigate("/recipes/" + id);
    } catch (err) {
      reportError("save:recipe-edit", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveDraft() {
    if (!id || !draft) return;
    setError(null);
    try {
      const saved = await saveEditDraft(id, draft, familyId, visibility, baseUpdatedAt, draftId ?? undefined);
      setDraftId(saved);
      setDraftNote("Draft saved.");
    } catch (err) {
      reportError("save:draft", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handlePrefill(incoming: RecipeDraft) {
    setDraft((cur) => (cur ? mergeDraft(cur, incoming) : incoming));
  }

  function handleCover(e: ChangeEvent<HTMLInputElement>) {
    setCoverFile(e.target.files?.[0] ?? null);
  }

  if (loading) return <Skeleton shape="plate" count={4} />;
  if (!draft) return <p>Recipe not found.</p>;

  return (
    <div>
      <h1>Edit recipe</h1>
      {error && <p role="alert">{error}</p>}
      {/* The wording says the recipe changed, because that is what happened and what the cook
          has to weigh. "Conflict" would name the mechanism and leave them guessing. */}
      {moved && (
        <div role="alert">
          <p>The recipe changed since this edit was started.</p>
          <button type="button" onClick={handlePublishAnyway}>Publish anyway</button>
          <button type="button" onClick={() => setMoved(false)}>Keep my draft</button>
        </div>
      )}
      <AiPrefillPanel onDraft={handlePrefill} />
      <form onSubmit={handleSubmit}>
        <IngredientEditor
          items={draft.ingredients}
          onChange={(ingredients) => setDraft((d) => (d ? { ...d, ingredients } : d))}
          itemSuggestions={itemSuggestions}
          sectionSuggestions={sectionSuggestions}
        />
        <StepEditor
          items={draft.steps}
          // Every setDraft on this page uses the updater form, and it is not a style choice.
          // StepEditor calls onChange AND onIngredientsFound in the SAME tick after the mic or
          // Tidy, React batches them, and a `{ ...draft }` spread off the render closure meant
          // the second call wrote back the steps from BEFORE the first. The box still showed the
          // dictated steps, because StepEditor owns its own text, so the loss only appeared once
          // the recipe was saved with them missing.
          onChange={(steps) => setDraft((d) => (d ? { ...d, steps } : d))}
          // Only when the cook has not written any ingredients themselves. Tidy and the mic
          // extract a whole recipe, and dropping what they found was silent data loss; but
          // overwriting ingredients someone typed would be worse than the bug being fixed.
          onIngredientsFound={(found) => {
            if (draft.ingredients.some((i) => i.item.trim())) return 0;
            setDraft((d) => (d ? { ...d, ingredients: found } : d));
            return found.length;
          }}
        />
        <label>
          Title
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
            placeholder="Title"
          />
        </label>
        <label>
          Servings
          <input
            type="number"
            value={draft.servings ?? ""}
            onChange={(e) => setDraft((d) => (d ? { ...d, servings: toNumber(e.target.value) } : d))}
          />
        </label>
        <label>
          Prep minutes
          <input
            type="number"
            value={draft.prep_minutes ?? ""}
            onChange={(e) => setDraft((d) => (d ? { ...d, prep_minutes: toNumber(e.target.value) } : d))}
          />
        </label>
        <label>
          Cook minutes
          <input
            type="number"
            value={draft.cook_minutes ?? ""}
            onChange={(e) => setDraft((d) => (d ? { ...d, cook_minutes: toNumber(e.target.value) } : d))}
          />
        </label>
        <label>
          Story
          <textarea
            value={draft.story}
            onChange={(e) => setDraft((d) => (d ? { ...d, story: e.target.value } : d))}
          />
        </label>
        <label>
          Provenance
          <textarea
            value={draft.provenance}
            onChange={(e) => setDraft((d) => (d ? { ...d, provenance: e.target.value } : d))}
          />
        </label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        <TagPicker familyId={familyId} value={tagIds} onChange={setTagIds} />
        <label>
          Cover photo
          <input type="file" accept="image/*" onChange={handleCover} />
        </label>
        <button type="submit">Save</button>
        {/* The reason sits beside the button, not only at the top of the form. A disabled
            control whose explanation is off screen is a silent failure in a different
            costume, which is the bug that was just fixed on the create page's Save button. */}
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={!draft.title.trim()}
        >
          Save draft
        </button>
        {!draft.title.trim() && (
          <span>A draft needs a title, so you can find it again.</span>
        )}
        {draftNote && <span role="status">{draftNote}</span>}
      </form>
    </div>
  );
}
