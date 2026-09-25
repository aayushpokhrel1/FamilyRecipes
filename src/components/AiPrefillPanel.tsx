import { useState, type ChangeEvent } from "react";
import { extractRecipe } from "../lib/api/extract";
import type { RecipeDraft } from "../lib/api/types";
import { blobToBase64, useRecorder } from "../lib/useRecorder";

// Image needs a vision MODEL_NAME; audio needs the edge function's TRANSCRIBE_*
// (Groq Whisper) configured. Both fail with a clear message otherwise.
type Mode = "text" | "url" | "image" | "audio";

const modes: { mode: Mode; label: string }[] = [
  { mode: "text", label: "Paste / write text" },
  { mode: "url", label: "URL" },
  { mode: "image", label: "Photo" },
  { mode: "audio", label: "Voice" },
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

  const {
    recording,
    supported: voiceSupported,
    start: handleRecord,
    stop: stopRecording,
    error: recorderError,
  } = useRecorder((base64) => run("audio", base64));

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
    <div className="plate ai-panel">
      <h2>Prefill with AI</h2>
      <div className="tag-row">
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
      {mode === "audio" && (
        <div>
          {voiceSupported ? (
            <>
              <button type="button" onClick={handleRecord} disabled={loading || recording}>
                Record
              </button>
              <button type="button" onClick={stopRecording} disabled={!recording}>
                Stop
              </button>
            </>
          ) : (
            <p>Voice capture not supported in this browser</p>
          )}
        </div>
      )}
      {(mode === "text" || mode === "url") && (
        <button type="button" onClick={handleSubmit} disabled={loading}>
          Extract
        </button>
      )}
      {recording && <p>Recording… tap Stop when done.</p>}
      {loading && <p>Extracting…</p>}
      {(error ?? recorderError) && <p role="alert">{error ?? recorderError}</p>}
    </div>
  );
}
