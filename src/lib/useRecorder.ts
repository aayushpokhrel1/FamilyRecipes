import { useRef, useState } from "react";

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

// Voice capture needs getUserMedia + MediaRecorder. Feature-detect both so the
// panel can show a fallback message instead of throwing (jsdom has neither).
function voiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof window !== "undefined" &&
    !!window.MediaRecorder
  );
}

export function useRecorder(onClip: (base64: string) => void | Promise<void>): {
  recording: boolean;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  error: string | null;
} {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  async function start() {
    if (!voiceSupported()) return;
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
          await onClip(base64);
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

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  return { recording, supported: voiceSupported(), start, stop, error };
}
