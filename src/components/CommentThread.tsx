import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { addComment, deleteComment, listComments } from "../lib/api/comments";
import type { CommentWithAuthor } from "../lib/api/comments";

// A comment carried its RAW timestamp to the screen until 2026-10-26:
// "2026-10-27T02:34:18.858908+00:00", microseconds and UTC offset included, under every
// comment in the app. Found by posting one as an invited relative in a browser; no test looked
// at the text, and `created_at` is a string either way so nothing failed.
//
// A timestamptz is a real INSTANT, so toLocaleDateString is right here. Do not reach for this
// with a date-only "YYYY-MM-DD" string: that parses as UTC midnight and renders as the
// previous day west of Greenwich, which is the trap src/admin/pages/Moderation.tsx documents
// next to its own two formatters.
function whenLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function CommentThread({ recipeId }: { recipeId: string }) {
  // comments_read admits every member of the family; comments_delete admits the AUTHOR alone.
  // The button was rendered on every comment, so deleting a relative's comment matched no rows,
  // resolved without an error, and the thread redrew with it still there. Same shape as the
  // shared meal plan and the recipe edit: read wider than write, and a refused write is not an
  // error. deleteComment now throws on zero rows as well, which this component already shows.
  const { userId } = useAuth();
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
            <p className="when">{whenLabel(c.created_at)}</p>
            {c.author_id === userId && (
              <button type="button" onClick={() => handleDelete(c.id)}>
                Delete
              </button>
            )}
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
