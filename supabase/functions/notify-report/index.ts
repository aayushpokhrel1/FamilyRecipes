// Supabase Edge Function: notify-report
// Emails the moderator that a report landed. The report ROW is the record; this is only a
// nudge, so nothing here may ever be load bearing.
// Deployed by Supabase only, and NEVER automatically: npx supabase functions deploy notify-report
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Validate the caller's JWT, not just the presence of the header. Same shape as
  // extract-recipe: an unauthenticated caller must not be able to make us send mail.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const client = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: { reportId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const reportId = body.reportId;
  if (!reportId) return json({ error: "reportId required" }, 400);

  const to = Deno.env.get("MODERATION_EMAIL");
  const key = Deno.env.get("RESEND_API_KEY");
  // Not an error the caller can fix, and not worth failing their report over. Say so in the
  // logs and return ok: the row is already saved and /moderation already shows it.
  if (!to || !key) {
    console.warn("notify-report: MODERATION_EMAIL or RESEND_API_KEY not set, skipping");
    return json({ ok: true, sent: false }, 200);
  }

  // Service role, because the reporter may read their own report but we want the recipe
  // title too, and the moderator is not the caller here.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const { data: report } = await admin
    .from("reports")
    .select("id, reason, note, recipe_id, recipes(title)")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return json({ error: "no such report" }, 404);

  const title = (report.recipes as { title?: string } | null)?.title ?? "a recipe";

  // The reporter's identity is deliberately NOT in this mail. It is not needed to decide
  // anything, and an email is the easiest place for it to leak.
  const text = [
    `A recipe was reported on Family Recipes.`,
    ``,
    `Recipe: ${title}`,
    `Reason: ${report.reason}`,
    report.note ? `Note: ${report.note}` : null,
    ``,
    `Review it: https://recipes.enamelvault.com/moderation`,
  ].filter((l) => l !== null).join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Family Recipes <noreply@mail.enamelvault.com>",
      // `to` comes from OUR environment, never from the request. A caller-supplied address
      // would turn this function into an open relay for spam signed by our domain.
      to: [to],
      subject: `Reported: ${title}`,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("notify-report: resend failed", res.status, detail);
    return json({ ok: true, sent: false }, 200);
  }
  return json({ ok: true, sent: true }, 200);
});
