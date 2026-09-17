import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { createRecipe } from "../lib/api/recipes";
import type { RecipeDraft, Visibility } from "../lib/api/types";
import IngredientEditor from "../components/IngredientEditor";
import StepEditor from "../components/StepEditor";
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
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft);
  const [visibility, setVisibility] = useState<Visibility>("family");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeFamily) return;
    setError(null);
    try {
      const created = await createRecipe(activeFamily.id, draft, visibility);
      navigate("/recipes/" + created.id);
    } catch (err) {
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
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
