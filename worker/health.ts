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
//
// noindex because NOTHING ELSE KEEPS A CRAWLER OUT OF HERE. Both health routes answer 200 to
// anyone, robots.txt says nothing about /health/, and a crawler is the one visitor that finds
// a URL nobody linked. Two reasons it matters more than tidiness: a crawl of /health/extract
// makes Googlebot an unwitting prober, since every hit sends a real request upstream and the
// answer is deliberately uncacheable; and an indexed /health/version publishes the deployed
// commit of a PUBLIC repository somewhere we cannot take it back, which tells a reader exactly
// which fixes are not live yet. The header, not only the robots line: robots.txt asks a
// crawler not to fetch, X-Robots-Tag tells it not to index what it fetched anyway.
function health(status: number, body: string): Response {
  return new Response(body, { status, headers: healthHeaders("text/plain") });
}

function healthHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

// The commit this Worker was BUILT from, stamped into dist/prerender/version.txt by
// scripts/stamp-version.mjs and served here so a deploy can be VERIFIED rather than assumed.
//
// This exists because on 2026-10-12 a push landed on GitHub, passed CI, and never produced a
// Cloudflare build at all: no failure, no notification, and the previous Worker went on
// serving 200s for over three hours. An outdated Worker is perfectly healthy, so
// /health/extract could never have caught it. CI compares this value against the commit it
// is testing and goes red when they disagree.
export const VERSION_PATH = "/health/version";

// Anchored, and it is doing real work rather than tidying. `not_found_handling` is
// "single-page-application", so a MISSING asset does not 404: env.ASSETS hands back
// index.html with a 200. Without this check a build that forgot to stamp would publish the
// entire SPA shell as its version string, and the comparison in CI would be against an HTML
// document rather than a commit.
const SHA = /^(?:[0-9a-f]{7,40}|dev)$/;

export async function checkVersion(fetchVersion: () => Promise<Response>): Promise<Response> {
  let sha = "unknown";
  try {
    const asset = await fetchVersion();
    if (asset.ok) {
      const text = (await asset.text()).trim();
      if (SHA.test(text)) sha = text;
    }
  } catch {
    // "unknown" is the right answer for every failure: CI compares against a real commit, so
    // it can never match, which is the alarm rather than a silent pass.
  }
  // NEVER cached, and never indexed: a cached version string is a lie about what is deployed,
  // and this route exists precisely to be trusted when everything else looks fine. See
  // healthHeaders above for why the crawler half is not merely tidiness.
  return new Response(sha, { status: 200, headers: healthHeaders("text/plain; charset=utf-8") });
}
