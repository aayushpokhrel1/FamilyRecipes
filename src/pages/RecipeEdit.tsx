import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecipe, updateRecipe } from "../lib/api/recipes";
import { getRecipeTagIds, setRecipeTags } from "../lib/api/tags";
import { uploadRecipePhoto } from "../lib/api/photos";
import type { RecipeDraft, Visibility } from "../lib/api/types";
import IngredientEditor from "../components/IngredientEditor";
import StepEditor from "../components/StepEditor";
import TagPicker from "../components/TagPicker";
import VisibilitySelect from "../components/VisibilitySelect";

function toNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

export default function RecipeEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("family");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getRecipe(id)
      .then(({ recipe, ingredients, steps }) => {
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
        return getRecipeTagIds(id).then(setTagIds);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id || !draft) return;
    setError(null);
    try {
      await updateRecipe(id, { ...draft, visibility });
      await setRecipeTags(id, tagIds);
      if (coverFile) await uploadRecipePhoto(id, coverFile, true);
      navigate("/recipes/" + id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCover(e: ChangeEvent<HTMLInputElement>) {
    setCoverFile(e.target.files?.[0] ?? null);
  }

  if (loading) return <p>Loading...</p>;
  if (!draft) return <p>Recipe not found.</p>;

  return (
    <div>
      <h1>Edit recipe</h1>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={handleSubmit}>
        <IngredientEditor
          items={draft.ingredients}
          onChange={(ingredients) => setDraft({ ...draft, ingredients })}
        />
        <StepEditor items={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />
        <label>
          Title
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
          />
        </label>
        <label>
          Servings
          <input
            type="number"
            value={draft.servings ?? ""}
            onChange={(e) => setDraft({ ...draft, servings: toNumber(e.target.value) })}
          />
        </label>
        <label>
          Prep minutes
          <input
            type="number"
            value={draft.prep_minutes ?? ""}
            onChange={(e) => setDraft({ ...draft, prep_minutes: toNumber(e.target.value) })}
          />
        </label>
        <label>
          Cook minutes
          <input
            type="number"
            value={draft.cook_minutes ?? ""}
            onChange={(e) => setDraft({ ...draft, cook_minutes: toNumber(e.target.value) })}
          />
        </label>
        <label>
          Story
          <textarea
            value={draft.story}
            onChange={(e) => setDraft({ ...draft, story: e.target.value })}
          />
        </label>
        <label>
          Provenance
          <textarea
            value={draft.provenance}
            onChange={(e) => setDraft({ ...draft, provenance: e.target.value })}
          />
        </label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        <TagPicker familyId={familyId} value={tagIds} onChange={setTagIds} />
        <label>
          Cover photo
          <input type="file" accept="image/*" onChange={handleCover} />
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
