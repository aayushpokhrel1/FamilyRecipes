import { useRef, useState, type ChangeEvent } from "react";
import { extractRecipe } from "../lib/api/extract";
import type { RecipeDraft } from "../lib/api/types";

// Image needs a vision MODEL_NAME; audio needs the edge function's TRANSCRIBE_*
// (Groq Whisper) configured. Both fail with a clear message otherwise.
type Mode = "text" | "url" | "image" | "audio";

const modes: { mode: Mode; label: string }[] = [
  { mode: "text", label: "Paste / write text" },
  { mode: "url", label: "URL" },
  { mode: "image", label: "Photo" },
  { mode: "audio", label: "Voice" },
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
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const voiceSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof window !== "undefined" &&
    !!window.MediaRecorder;

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

  async function handleRecord() {
    if (!voiceSupported) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        try {
          const base64 = await blobToBase64(new Blob(chunks, { type: recorder.mimeType }));
          await run("audio", base64);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
