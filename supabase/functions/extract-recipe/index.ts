// Supabase Edge Function: extract-recipe
// Turns raw input (text, url, image, audio) into a RecipeDraft. The AI never
// saves: it returns a draft that a human reviews in the create form.
// Deployed by Supabase only; not typechecked by the app's tsc.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseRecipeJsonLd } from "./jsonld.ts";
import { SYSTEM_PROMPT, DRAFT_SCHEMA } from "./prompt.ts";
import { callModelWithRetry } from "./retry.ts";
import { htmlToText } from "./htmlText.ts";
import { humanModelError } from "./errors.ts";
import { parseVisionFlag, shouldTryFallback } from "./fallback.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

// Pull the first JSON object out of a model reply (handles ```json fences).
function parseModelJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const raw = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("model returned no JSON");
    return JSON.parse(raw.slice(start, end + 1));
  }
}

// Send a base64 data-URL audio clip to an OpenAI-compatible transcription
// endpoint (Groq Whisper by default) and return the plain-text transcript.
async function transcribe(dataUrl: string, base: string, model: string, key: string): Promise<string> {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = comma >= 0 ? (dataUrl.slice(5, comma).split(";")[0] || "audio/webm") : "audio/webm";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg"
    : mime.includes("wav") ? "wav" : mime.includes("mp4") || mime.includes("m4a") ? "m4a"
    : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
  form.append("model", model);
  form.append("response_format", "text");
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` }, // FormData sets its own content-type boundary
    body: form,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.text()).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Validate the caller's JWT, not just the presence of the header.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const client = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: { mode?: string; payload?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const mode = body.mode ?? "text";
  const payload = body.payload ?? "";

  let inputText = payload;

  // Audio: transcribe to text via a Whisper-style endpoint (Groq by default),
  // then extract exactly like pasted text. Image is handled below as a
  // multimodal message and needs a vision-capable MODEL_NAME.
  if (mode === "audio") {
    const tKey = Deno.env.get("TRANSCRIBE_API_KEY");
    if (!tKey) return json({ error: "audio transcription not configured" }, 501);
    const tBase = (Deno.env.get("TRANSCRIBE_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const tModel = Deno.env.get("TRANSCRIBE_MODEL") ?? "whisper-large-v3-turbo";
    try {
      inputText = await transcribe(payload, tBase, tModel, tKey);
    } catch (err) {
      return json({ error: `transcription failed: ${String(err)}` }, 502);
    }
  }

  // URL fast path: embedded JSON-LD Recipe costs nothing and is exact.
  if (mode === "url") {
    try {
      const html = await (await fetch(payload)).text();
      const draft = parseRecipeJsonLd(html);
      if (draft) {
        draft.source_url = payload; // keep the source link for provenance
        return json(draft, 200);
      }
      // NOT the raw page: see htmlText.ts. Sending the whole thing exhausted a per-minute
      // input-token quota in a single request.
      inputText = htmlToText(html);
    } catch (err) {
      return json({ error: `could not fetch url: ${String(err)}` }, 502);
    }
  }

  const key = Deno.env.get("MODEL_API_KEY");
  const baseUrl = Deno.env.get("MODEL_BASE_URL");
  // Keyless local gateways (e.g. OmniRoute) set a base URL but no key. Treat the
  // model as configured if either is present; only a bare default with no config
  // at all is "not configured".
  if (!key && !baseUrl) return json({ error: "model not configured" }, 501);

  const base = (baseUrl ?? "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = Deno.env.get("MODEL_NAME") ?? "deepseek-chat";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`; // omit for keyless gateways

  // An OPTIONAL second provider, tried only when the first says "not now". One provider
  // having a bad minute used to end the attempt in the middle of adding a recipe: a free-tier
  // 429 and a 503 "high demand" on 2026-09-30, both from the same model within an hour.
  // Configure with FALLBACK_MODEL_BASE_URL plus FALLBACK_MODEL_API_KEY and
  // FALLBACK_MODEL_NAME; leave them unset and behaviour is exactly as before.
  const fbBase = Deno.env.get("FALLBACK_MODEL_BASE_URL");
  const fbKey = Deno.env.get("FALLBACK_MODEL_API_KEY");
  const fbModel = Deno.env.get("FALLBACK_MODEL_NAME");
  // Opt-in, because vision cannot be detected, only declared. See fallback.ts for why the
  // default has to be "cannot see".
  const fbSeesImages = parseVisionFlag(Deno.env.get("FALLBACK_MODEL_VISION"));
  const fallback = (fbBase || fbKey) && fbModel
    ? {
        base: (fbBase ?? base).replace(/\/$/, ""),
        model: fbModel,
        headers: {
          "content-type": "application/json",
          ...(fbKey ? { authorization: `Bearer ${fbKey}` } : {}),
        } as Record<string, string>,
      }
    : null;

  // NOT `body`: the request body is already declared above, and redeclaring it stops the
  // isolate booting at all. Deploy does not typecheck, so it shipped as a 503 BOOT_ERROR on
  // every mode. boots.test.ts is the guard: it parses AND binds every file in this directory,
  // and it is the real thing, unlike the comment that used to sit here claiming a guard that
  // did not exist.
  const bodyFor = (m: string) => JSON.stringify({
    model: m,
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\nSchema: " + JSON.stringify(DRAFT_SCHEMA) },
      // Image mode sends the photo as a multimodal message (needs a vision
      // model); text/url send the plain text extracted above.
      mode === "image"
        ? { role: "user", content: [
            { type: "text", text: "Extract the recipe shown in this image." },
            { type: "image_url", image_url: { url: payload } },
          ] }
        : { role: "user", content: inputText },
    ],
  });


  const attempt = (b: string, h: Record<string, string>, m: string) =>
    callModelWithRetry(`${b}/chat/completions`, h, bodyFor(m));

  try {
    let res = await attempt(base, headers, model);
    let detail = res.ok ? "" : await res.text();

    // Every reason to try or not try the second provider lives in fallback.ts, where it is
    // unit tested: a fallback skipped when it should fire is indistinguishable from an
    // outage, and one that fires when it cannot help reports the WRONG error.
    const decision = shouldTryFallback({
      ok: res.ok,
      status: res.status,
      mode,
      hasFallback: fallback !== null,
      fallbackSeesImages: fbSeesImages,
    });
    if (!res.ok && !decision.try) {
      console.warn(`extract-recipe: not using a fallback: ${decision.reason}`);
    }
    if (decision.try && fallback) {
      console.warn(`extract-recipe: ${model} returned ${res.status}, trying ${fallback.model}`);
      const fbRes = await attempt(fallback.base, fallback.headers, fallback.model);
      if (fbRes.ok) {
        res = fbRes;
        detail = "";
      } else {
        // Report the PRIMARY failure: it is the configured model and the more informative
        // error, and a vision 400 from the fallback would only mislead.
        console.warn(`extract-recipe: fallback ${fallback.model} also failed (${fbRes.status})`);
      }
    }

    if (!res.ok) {
      // The provider's raw JSON used to reach the cook's screen verbatim. It stays in the
      // function logs, where it is useful, and the reply says what to do instead.
      // The provider's own body stays in the FUNCTION LOGS and goes no further. It is what
      // you want when debugging and it is nothing a browser needs, so the reply carries the
      // wording and the status only.
      console.error(`extract-recipe: model error ${res.status}: ${detail}`);
      return json({ error: humanModelError(res.status), status: res.status }, 502);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return json({ error: "The recipe assistant sent nothing back. Try again, or type the recipe in by hand." }, 502);
    const parsed = parseModelJson(content) as Record<string, unknown>;
    if (mode === "url") parsed.source_url = payload; // keep the source link for provenance
    return json(parsed, 200);
  } catch (err) {
    console.error(`extract-recipe: model call failed: ${String(err)}`);
    return json({ error: "The recipe assistant could not be reached. Check your connection, or type the recipe in by hand." }, 502);
  }
});
