import { useState } from "react";
import { extractRecipe } from "../lib/api/extract";
import type { RecipeDraft } from "../lib/api/types";

// Image and audio are intentionally omitted: the configured model is text-only,
// so those modes returned garbage. Re-add them when a vision / transcription
// model is wired (the edge function rejects them until then).
type Mode = "text" | "url";

const modes: { mode: Mode; label: string }[] = [
  { mode: "text", label: "Paste / write text" },
  { mode: "url", label: "URL" },
];

export default function AiPrefillPanel({ onDraft }: { onDraft: (draft: RecipeDraft) => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(m: Mode, payload: string) {
    setError(null);
    setLoading(true);
    try {
      const draft = await extractRecipe(m, payload);
      onDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (mode === "text") await run("text", text);
    else await run("url", url);
  }

  return (
    <div>
      <h2>Prefill with AI</h2>
      <div>
        {modes.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={mode === m.mode}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "text" && (
        <label>
          Recipe text
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {mode === "url" && (
        <label>
          Recipe URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
      )}
      <button type="button" onClick={handleSubmit} disabled={loading}>
        Extract
      </button>
      {loading && <p>Extracting…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
