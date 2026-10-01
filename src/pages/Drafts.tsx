import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDrafts, deleteDraft } from "../lib/api/drafts";
import { reportError } from "../lib/api/errorLog";
import type { SavedDraft } from "../lib/api/types";

export default function Drafts() {
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listDrafts()
      .then(setDrafts)
      .catch((err) => {
        reportError("list:drafts", err);
        setDrafts([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    try {
      await deleteDraft(id);
      setDrafts((d) => d.filter((x) => x.id !== id));
    } catch (err) {
      reportError("delete:draft", err);
    }
  }

  // A timestamptz is a real instant, so toLocaleDateString is right here.
  function whenLabel(updatedAt: string): string {
    return "last touched " + new Date(updatedAt).toLocaleDateString(undefined, {
      month: "long", day: "numeric", year: "numeric",
    });
  }

  return (
    <div>
      <h1>Drafts</h1>
      {!loading && drafts.length === 0 && <p className="vault-note">No drafts yet.</p>}
      <ul className="stack">
        {drafts.map((d) => (
          <li key={d.id} className="plate plate-row">
            {/* An edit draft and a create draft are different things, so they read differently.
                "Editing" says the recipe already exists and this is a change to it, which is
                also why the Resume link goes to the edit page rather than the create form. */}
            <span>{d.target_recipe_id ? "Editing " + d.draft.title : d.draft.title}</span>
            <span className="stamp">{whenLabel(d.updated_at)}</span>
            <Link
              to={d.target_recipe_id
                ? "/recipes/" + d.target_recipe_id + "/edit?draft=" + d.id
                : "/recipes/new?draft=" + d.id}
            >
              Resume
            </Link>
            <button type="button" onClick={() => handleDelete(d.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
