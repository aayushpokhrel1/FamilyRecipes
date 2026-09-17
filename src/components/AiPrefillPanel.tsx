import { useState, type ChangeEvent } from "react";
import { extractRecipe } from "../lib/api/extract";
import type { RecipeDraft } from "../lib/api/types";

// Audio is intentionally omitted: it needs a transcription endpoint, which is
// not wired. Image works only when the edge function's MODEL_NAME is a vision
// model (the function sends the photo as a multimodal message).
type Mode = "text" | "url" | "image";

const modes: { mode: Mode; label: string }[] = [
  { mode: "text", label: "Paste / write text" },
  { mode: "url", label: "URL" },
  { mode: "image", label: "Photo" },
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

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
    else if (mode === "url") await run("url", url);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await blobToBase64(file);
      await run("image", base64);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
      {mode === "image" && (
        <label>
          Photo
          <input type="file" accept="image/*" onChange={handleFile} disabled={loading} />
        </label>
      )}
      {(mode === "text" || mode === "url") && (
        <button type="button" onClick={handleSubmit} disabled={loading}>
          Extract
        </button>
      )}
      {loading && <p>Extracting…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
