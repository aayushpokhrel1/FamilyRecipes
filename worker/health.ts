// A health check for the extract-recipe edge function, reachable by a plain HEAD to a plain
// URL. That shape is forced by the monitoring side: UptimeRobot's free plan can send only HEAD
// with no custom headers, and every unauthenticated request to a Supabase function is rejected
// by the GATEWAY with 401 before the function is started. So a monitor pointed straight at the
// function sees the same 401 whether it is healthy or dead, and would stay green through an
// outage. This route does the part the monitor cannot.
//
// The probe is an OPTIONS request because the function answers the CORS preflight in its own
// first branch, above its auth check, so a 204 proves the isolate parsed, booted and ran our
// code. That is exactly the failure this exists for: on 2026-09-27 a duplicate declaration made
// the function unparseable and every request got 503 BOOT_ERROR for ~90 minutes, discovered
// only because a person hit it. OPTIONS also needs no credential, so this route holds nothing.
export const HEALTH_PATH = "/health/extract";

const TIMEOUT_MS = 5000;

export async function checkExtract(
  supabaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let detail: string;
  try {
    const upstream = await fetchImpl(`${supabaseUrl}/functions/v1/extract-recipe`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (upstream.ok) return health(200, `ok ${upstream.status}`);
    // Anything else is a failure, INCLUDING a 401. A 401 here would mean the preflight itself
    // was refused, which proves nothing about whether the function booted, so treating it as
    // healthy would rebuild the exact blind spot this route exists to avoid.
    detail = `upstream ${upstream.status}`;
  } catch {
    // A timeout or a network failure is a failure. Reporting it as healthy would be worse
    // than not checking at all, because it would look like coverage.
    detail = "unreachable";
  }
  return health(503, detail);
}

// no-store because a cached "ok" is a monitor that cannot see an outage.
function health(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}
