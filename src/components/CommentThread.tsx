import { useCallback, useEffect, useState } from "react";
import { addComment, deleteComment, listComments } from "../lib/api/comments";
import type { CommentWithAuthor } from "../lib/api/comments";

export default function CommentThread({ recipeId }: { recipeId: string }) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return listComments(recipeId)
      .then(setComments)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [recipeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    if (!text.trim()) return;
    setError(null);
    try {
      await addComment(recipeId, text);
      setText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteComment(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h2>Comments</h2>
      {error && <p role="alert">{error}</p>}
      <ul className="stack">
        {comments.map((c) => (
          <li key={c.id} className="plate comment">
            <p className="who">{c.profiles?.display_name ?? "Someone"}</p>
            <p>{c.body}</p>
            <p className="when">{c.created_at}</p>
            <button type="button" onClick={() => handleDelete(c.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {/* aria-label, not a placeholder: a placeholder vanishes as soon as you type and is
          not reliably announced, so the field was reaching screen readers as "edit, blank". */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Write a comment"
      />
      <button type="button" onClick={handleAdd}>
        Add comment
      </button>
    </div>
  );
}
