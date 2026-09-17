// Supabase Edge Function: extract-recipe
// Turns raw input (text, url, image, audio) into a RecipeDraft. The AI never
// saves: it returns a draft that a human reviews in the create form.
// Deployed by Supabase only; not typechecked by the app's tsc.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseRecipeJsonLd } from "./jsonld.ts";
import { SYSTEM_PROMPT, DRAFT_SCHEMA } from "./prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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

  // Audio needs a transcription endpoint, which is not wired. Image is handled
  // below as a multimodal message and requires a vision-capable MODEL_NAME.
  if (mode === "audio") {
    return json({ error: "audio extraction is not available yet" }, 501);
  }

  // URL fast path: embedded JSON-LD Recipe costs nothing and is exact.
  let inputText = payload;
  if (mode === "url") {
    try {
      const html = await (await fetch(payload)).text();
      const draft = parseRecipeJsonLd(html);
      if (draft) {
        draft.source_url = payload; // keep the source link for provenance
        return json(draft, 200);
      }
      inputText = html;
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

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
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
      }),
    });
    if (!res.ok) {
      return json({ error: `model error ${res.status}: ${await res.text()}` }, 502);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return json({ error: "model returned no content" }, 502);
    const parsed = parseModelJson(content) as Record<string, unknown>;
    if (mode === "url") parsed.source_url = payload; // keep the source link for provenance
    return json(parsed, 200);
  } catch (err) {
    return json({ error: `model call failed: ${String(err)}` }, 502);
  }
});
