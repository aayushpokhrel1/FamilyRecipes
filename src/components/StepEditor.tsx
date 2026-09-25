import { useEffect, useState } from "react";
import { extractRecipe } from "../lib/api/extract";
import type { Step } from "../lib/api/types";
import { useRecorder } from "../lib/useRecorder";

function toSteps(text: string): Step[] {
  return text.split("\n").map((t) => t.trim()).filter(Boolean)
    .map((text, position) => ({ position, text }));
}

export default function StepEditor({
  items,
  onChange,
}: {
  items: Step[];
  onChange: (items: Step[]) => void;
}) {
  // The box owns its own string. Deriving the value from `items` on every
  // keystroke would delete a blank line the moment Enter is pressed, so a new
  // step could never be typed. Local state, pushed up on change.
  const [text, setText] = useState(() => items.map((s) => s.text).join("\n"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync only when items change from OUTSIDE (the AI prefill panel replacing
  // the draft, or the edit page loading a recipe). Comparing against what this
  // box would produce keeps normal typing from fighting the parent.
  useEffect(() => {
    const fromItems = items.map((s) => s.text).join("\n");
    if (toSteps(text).map((s) => s.text).join("\n") !== fromItems) setText(fromItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function handleChange(next: string) {
    setText(next);
    onChange(toSteps(next));
  }

  const {
    recording,
    supported,
    start: startRecording,
    stop: stopRecording,
    error: recorderError,
  } = useRecorder(async (base64) => {
    setError(null);
    setLoading(true);
    try {
      const draft = await extractRecipe("audio", base64);
      // Append, never replace: someone may dictate in more than one go, and
      // silently destroying what is already in the box is unforgivable.
      const spoken = draft.steps.map((s) => s.text).join("\n");
      const combined = [text.trim(), spoken].filter(Boolean).join("\n");
      setText(combined);
      onChange(toSteps(combined));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  });

  async function handleTidy() {
    setError(null);
    setLoading(true);
    try {
      const draft = await extractRecipe("text", text);
      const tidied = draft.steps.map((s) => s.text).join("\n");
      setText(tidied);
      onChange(toSteps(tidied));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>How it's made</h2>
      <label>
        Steps
        <textarea
          className="step-text"
          rows={8}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="One step per line. Or press the mic and just say it."
        />
      </label>
      <div className="editor-row">
        {supported && (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={loading}
          >
            {recording ? "Stop" : "Speak the steps"}
          </button>
        )}
        {text.trim() !== "" && (
          <button type="button" className="action" onClick={handleTidy} disabled={loading}>
            {loading ? "Tidying…" : "Tidy into steps"}
          </button>
        )}
      </div>
      {recording && <p className="vault-note">Recording… tap Stop when done.</p>}
      {(error ?? recorderError) && <p role="alert" className="form-error">{error ?? recorderError}</p>}
    </div>
  );
}
