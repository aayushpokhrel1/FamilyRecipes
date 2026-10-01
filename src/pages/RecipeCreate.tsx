import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { createRecipe, listFamilyIngredientNames, listFamilySectionNames } from "../lib/api/recipes";
import { getDraft, saveDraft, deleteDraft } from "../lib/api/drafts";
import { setRecipeTags } from "../lib/api/tags";
import { uploadRecipePhoto } from "../lib/api/photos";
import { reportError } from "../lib/api/errorLog";
import type { RecipeDraft, Visibility } from "../lib/api/types";
import AiPrefillPanel from "../components/AiPrefillPanel";
import IngredientEditor from "../components/IngredientEditor";
import StepEditor from "../components/StepEditor";
import TagPicker from "../components/TagPicker";
import VisibilitySelect from "../components/VisibilitySelect";

const emptyDraft: RecipeDraft = {
  title: "",
  story: "",
  provenance: "",
  servings: null,
  prep_minutes: null,
  cook_minutes: null,
  ingredients: [],
  steps: [],
  source_url: null,
};

function toNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

export default function RecipeCreate() {
  const { activeFamily } = useFamily();
  const navigate = useNavigate();
  const [itemSuggestions, setItemSuggestions] = useState<string[]>([]);
  const [sectionSuggestions, setSectionSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (activeFamily) {
      listFamilyIngredientNames(activeFamily.id).then(setItemSuggestions).catch(() => setItemSuggestions([]));
      listFamilySectionNames(activeFamily.id).then(setSectionSuggestions).catch(() => setSectionSuggestions([]));
    }
  }, [activeFamily]);
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft);
  const [visibility, setVisibility] = useState<Visibility>("family");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draft"));
  const [draftNote, setDraftNote] = useState<string | null>(null);

  // A draft id in the query string means the cook came here to finish that draft, so the
  // form has to be filled from it. A load that fails reports and says so: leaving the blank
  // form on screen would look exactly like a new recipe and quietly lose the draft.
  useEffect(() => {
    const id = searchParams.get("draft");
    if (!id) return;
    getDraft(id)
      .then((saved) => {
        setDraft(saved.draft);
        setVisibility(saved.visibility);
      })
      .catch((err) => {
        reportError("load:draft", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [searchParams]);

  function handleDraft(d: RecipeDraft) {
    setDraft(d);
  }

  function handleCover(e: ChangeEvent<HTMLInputElement>) {
    setCoverFile(e.target.files?.[0] ?? null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeFamily) return;
    setError(null);
    try {
      const created = await createRecipe(activeFamily.id, draft, visibility);
      if (tagIds.length) await setRecipeTags(created.id, tagIds);
      if (coverFile) await uploadRecipePhoto(created.id, coverFile, true);
      // The recipe is created FIRST and the draft deleted after, never the other way round.
      // A failed delete leaves the cook their recipe and a stale draft, which is recoverable
      // and visible. The other order risks destroying the work and then failing to create
      // the recipe. The delete gets its own catch so a failure cannot stop the navigate.
      if (draftId) {
        try {
          await deleteDraft(draftId);
        } catch (err) {
          reportError("delete:draft", err);
        }
      }
      navigate("/recipes/" + created.id);
    } catch (err) {
      reportError("save:recipe-create", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveDraft() {
    if (!activeFamily) return;
    setError(null);
    try {
      const id = await saveDraft(draft, activeFamily.id, visibility, draftId ?? undefined);
      setDraftId(id);
      setDraftNote("Draft saved.");
    } catch (err) {
      reportError("save:draft", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>New recipe</h1>
      {!activeFamily && (
        <p>
          Create or join a family to add recipes. <Link to="/families">Families</Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <AiPrefillPanel onDraft={handleDraft} />
      <form onSubmit={handleSubmit}>
        <IngredientEditor
          items={draft.ingredients}
          onChange={(ingredients) => setDraft((d) => ({ ...d, ingredients }))}
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
          onChange={(steps) => setDraft((d) => ({ ...d, steps }))}
          // Only when the cook has not written any ingredients themselves. Tidy and the mic
          // extract a whole recipe, and dropping what they found was silent data loss; but
          // overwriting ingredients someone typed would be worse than the bug being fixed.
          onIngredientsFound={(found) => {
            if (draft.ingredients.some((i) => i.item.trim())) return 0;
            setDraft((d) => ({ ...d, ingredients: found }));
            return found.length;
          }}
        />
        <label>
          Title
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Title"
          />
        </label>
        <label>
          Servings
          <input
            type="number"
            value={draft.servings ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, servings: toNumber(e.target.value) }))}
          />
        </label>
        <label>
          Prep minutes
          <input
            type="number"
            value={draft.prep_minutes ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, prep_minutes: toNumber(e.target.value) }))}
          />
        </label>
        <label>
          Cook minutes
          <input
            type="number"
            value={draft.cook_minutes ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, cook_minutes: toNumber(e.target.value) }))}
          />
        </label>
        <label>
          Story
          <textarea
            value={draft.story}
            onChange={(e) => setDraft((d) => ({ ...d, story: e.target.value }))}
          />
        </label>
        <label>
          Provenance
          <textarea
            value={draft.provenance}
            onChange={(e) => setDraft((d) => ({ ...d, provenance: e.target.value }))}
          />
        </label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        {activeFamily && (
          <TagPicker familyId={activeFamily.id} value={tagIds} onChange={setTagIds} />
        )}
        <label>
          Cover photo
          <input type="file" accept="image/*" onChange={handleCover} />
        </label>
        {/* The reason sits next to the button, not only at the top of the form. This state is
            reachable (a cook who leaves every family lands in it), and a disabled control with
            its explanation off screen is the same silent failure in a different costume. */}
        <button type="submit" disabled={!activeFamily}>Save</button>
        {!activeFamily && <span>Setting up your kitchen. Reload if this does not clear.</span>}
        {/* The reason sits beside the button, not only at the top of the form. A disabled
            control whose explanation is off screen is a silent failure in a different
            costume, which is the bug that was just fixed on the Save button above. */}
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={!activeFamily || !draft.title.trim()}
        >
          Save draft
        </button>
        {activeFamily && !draft.title.trim() && (
          <span>A draft needs a title, so you can find it again.</span>
        )}
        {draftNote && <span role="status">{draftNote}</span>}
      </form>
    </div>
  );
}
