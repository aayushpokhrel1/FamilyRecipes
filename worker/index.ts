// The site was served straight from static assets until now. This Worker sits in front so
// that /recipes/:id can carry its own OpenGraph tags: a crawler does not run the SPA, so
// anything it should see has to be in the HTML before it is served.
//
// Everything not explicitly handled falls through to the assets binding untouched, which is
// exactly what the assets-only config did before. Keep it that way: a recipe page must never
// fail to load because a preview could not be built.
import { checkExtract, HEALTH_PATH } from "./health";
import {
  avatarHandleFromPath,
  buildRecipeJsonLd,
  buildSitemap,
  buildTags,
  ogIdFromPath,
  recipeIdFromPath,
  securityHeaders,
  type SitemapEntry,
  type Tags,
} from "./meta";
import {
  APP_ORIGIN,
  isSiteHost,
  renderSite,
  siteRobots,
  siteSitemap,
  type SiteCard,
} from "./site";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type RecipeRow = {
  title: string;
  story: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
};
type PhotoRow = { storage_path: string | null; is_cover: boolean | null };
type IngredientRow = { quantity: string | null; unit: string | null; item: string | null };
type StepRow = { text: string | null };

// The anon key is the whole security model here, so it is the only credential we send. The
// recipes table has an RLS policy that applies to the anonymous role and only ever returns
// rows whose visibility is 'public' to an unauthenticated caller, so a row coming back IS the
// proof that the recipe is public. Do not add a visibility check on top of that: a second
// source of truth can drift from the first, and this one fails closed by construction.
function supabaseHeaders(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

async function fetchRecipe(env: Env, id: string): Promise<RecipeRow | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/recipes?id=eq.${id}&select=title,story,servings,prep_minutes,cook_minutes&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders(env) });
  if (!response.ok) return null;

  const rows = (await response.json()) as RecipeRow[];
  return rows.length > 0 ? rows[0] : null;
}

// Swallows its OWN failures rather than letting them reach the caller, and that is the whole
// point of the try. These two feed the JSON-LD only. If a rejection escaped, Promise.all in
// enrichRecipePage would reject, the outer catch would serve the untouched asset, and a
// structured-data fetch failing would silently strip the OpenGraph tags that worked fine
// before JSON-LD existed. A recipe with no ingredient list is still valid structured data.
async function fetchIngredients(env: Env, id: string): Promise<IngredientRow[]> {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/recipe_ingredients?recipe_id=eq.${id}&select=quantity,unit,item&order=position`;
    const response = await fetch(url, { headers: supabaseHeaders(env) });
    if (!response.ok) return [];

    return (await response.json()) as IngredientRow[];
  } catch {
    return [];
  }
}

// Same contract as fetchIngredients above, for the same reason: never reject.
async function fetchSteps(env: Env, id: string): Promise<StepRow[]> {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/recipe_steps?recipe_id=eq.${id}&select=text&order=position`;
    const response = await fetch(url, { headers: supabaseHeaders(env) });
    if (!response.ok) return [];

    return (await response.json()) as StepRow[];
  } catch {
    return [];
  }
}

// An ingredient line is [quantity, unit, item] joined by single spaces with the empty and null
// parts dropped, so {quantity: "2", unit: null, item: "eggs"} becomes "2 eggs".
function ingredientLine(row: IngredientRow): string {
  return [row.quantity, row.unit, row.item]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ");
}

async function fetchHasPhoto(env: Env, id: string): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/recipe_photos?recipe_id=eq.${id}&select=id&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders(env) });
  if (!response.ok) return false;

  const rows = (await response.json()) as unknown[];
  return rows.length > 0;
}

type CatalogueRow = { id: string; title: string };

// THE RPC, NEVER THE recipes TABLE. The rule that hides a cleared cook's public recipes
// lives inside search_recipes and nowhere else, and 0035 says so in a comment at the
// function: a second path that queried recipes directly silently bypassed every rule the
// function held, and a muted cook stayed in the feed until you typed something.
// src/lib/api/recipes.ts refuses to grow a second path for the same reason. A landing page
// reading the table would be a PUBLIC bypass of a live moderation decision, which is worse
// than the bug that comment describes.
async function fetchCatalogue(env: Env, limit: number): Promise<SiteCard[]> {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/search_recipes?select=id,title&limit=${limit}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ p_family_id: null, p_search: null, p_tag_id: null }),
  });
  if (!response.ok) return [];

  const rows = (await response.json()) as CatalogueRow[];
  const cards = rows.filter((row) => row.id && row.title).slice(0, limit);
  // One request per card, in parallel, and each failure is just "no photo". hasPhoto only
  // decides whether an <img> is drawn, so getting it wrong costs a picture, never the page.
  return Promise.all(
    cards.map(async (row) => ({
      id: row.id,
      title: row.title,
      hasPhoto: await fetchHasPhoto(env, row.id),
    })),
  );
}

// The static pages are hard-coded because they are the same five for every deployment, and
// they carry no lastmod: there is no per-page timestamp to report and a made-up one would
// teach Google to distrust the field.
// NOT "/": on this host the root is behind RequireAuth and bounces a signed-out visitor,
// crawlers included, to /signin. The root worth indexing is https://enamelvault.com/, which
// is in that host's own sitemap.
const STATIC_SITEMAP_PATHS = ["/terms", "/privacy", "/cookies", "/help"];

type RecipeSitemapRow = { id: string; updated_at: string | null };
type CookSitemapRow = { handle: string | null };

// A sitemap is a nice-to-have; a 500 is not. Any Supabase failure degrades to the static
// pages, which is still a valid sitemap that lists five real URLs.
async function serveSitemap(env: Env, origin: string): Promise<Response> {
  const entries: SitemapEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({ loc: `${origin}${path}` }));

  try {
    // removed_at=is.null is NOT redundant with RLS: a recipe a moderator took down is still a
    // public-visibility row, and listing it here would actively invite Google to index
    // something we removed.
    const recipesUrl = `${env.SUPABASE_URL}/rest/v1/recipes?select=id,updated_at&removed_at=is.null&order=updated_at.desc&limit=5000`;
    const cooksUrl = `${env.SUPABASE_URL}/rest/v1/public_cooks?select=handle&limit=5000`;
    const [recipesResponse, cooksResponse] = await Promise.all([
      fetch(recipesUrl, { headers: supabaseHeaders(env) }),
      fetch(cooksUrl, { headers: supabaseHeaders(env) }),
    ]);

    if (recipesResponse.ok) {
      const recipes = (await recipesResponse.json()) as RecipeSitemapRow[];
      for (const recipe of recipes) {
        entries.push({ loc: `${origin}/recipes/${recipe.id}`, lastmod: recipe.updated_at });
      }
    }
    if (cooksResponse.ok) {
      const cooks = (await cooksResponse.json()) as CookSitemapRow[];
      for (const cook of cooks) {
        if (cook.handle) entries.push({ loc: `${origin}/cooks/${cook.handle}` });
      }
    }
  } catch {
    // Keep whatever was collected before the failure: the static pages are always in there.
  }

  return new Response(buildSitemap(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const SITE_CARDS = 3;

// Degrades in every direction on purpose. A failed template fetch serves whatever the asset
// layer gave us; a failed or empty catalogue drops the rack and serves the rest. The page
// must not 500 and must not come back blank, which is the Worker rule in CLAUDE.md.
async function serveSite(request: Request, env: Env): Promise<Response> {
  const template = await env.ASSETS.fetch(new Request(`${new URL(request.url).origin}/site.html`));
  if (!template.ok) return template;

  const html = await template.text();
  let cards: SiteCard[] = [];
  try {
    cards = await fetchCatalogue(env, SITE_CARDS);
  } catch {
    // The rack is the only thing lost, and renderSite removes the placeholder for an
    // empty list, so no visible hole is left behind.
  }

  return new Response(renderSite(html, cards), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Five minutes. A crawl must not mean one Supabase round trip per hit, and the
      // catalogue changing five minutes late costs nothing.
      "Cache-Control": "public, max-age=300",
    },
  });
}

// Every failure path here is the same answer on purpose: a private recipe and a recipe that
// does not exist must be indistinguishable, or the status itself leaks which is which.
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

// The photo is proxied rather than redirected to the signed URL. A redirect would hand the
// caller a bearer URL that keeps working after the recipe stops being public, so the stable,
// revocable /og/recipe/:id.jpg is the only thing that should ever leave this Worker.
async function serveOgImage(env: Env, id: string): Promise<Response> {
  try {
    // The recipe_photos RLS policy is gated on the same can_read_recipe predicate as the
    // recipes table, so an anon read returning a row IS the proof the recipe is public. No
    // row means the read was refused: 404, with no visibility check layered on top.
    const photoUrl = `${env.SUPABASE_URL}/rest/v1/recipe_photos?recipe_id=eq.${id}&select=storage_path,is_cover&order=is_cover.desc&limit=1`;
    const photoResponse = await fetch(photoUrl, { headers: supabaseHeaders(env) });
    if (!photoResponse.ok) return notFound();

    const photos = (await photoResponse.json()) as PhotoRow[];
    const storagePath = photos.length > 0 ? photos[0].storage_path : null;
    if (!storagePath) return notFound();

    // storage_path is <recipeId>/<uuid>, so it is interpolated as-is: encoding it would
    // escape the separator and point the signing request at a path that does not exist.
    const signUrl = `${env.SUPABASE_URL}/storage/v1/object/sign/recipe-photos/${storagePath}`;
    const signResponse = await fetch(signUrl, {
      method: "POST",
      headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!signResponse.ok) return notFound();

    const signed = (await signResponse.json()) as { signedURL?: string };
    if (!signed.signedURL) return notFound();

    // The signed URL is relative to the storage API root, not to the Supabase origin.
    const imageResponse = await fetch(`${env.SUPABASE_URL}/storage/v1${signed.signedURL}`);
    if (!imageResponse.ok) return notFound();

    return new Response(imageResponse.body, {
      headers: {
        "Content-Type": imageResponse.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return notFound();
  }
}

// Same shape and the same security model as serveOgImage: the anon key is the only
// credential, so a row coming back from public_cooks IS the proof this cook publishes, and
// a signable avatar object IS the proof the 0022 policy allows it. The image is proxied
// rather than redirected, so clearing a handle revokes this URL on the next request instead
// of leaving a signed URL working in someone's cache.
async function serveAvatar(env: Env, handle: string): Promise<Response> {
  try {
    const cookUrl = `${env.SUPABASE_URL}/rest/v1/public_cooks?handle=eq.${handle}&select=avatar_url&limit=1`;
    const cookResponse = await fetch(cookUrl, { headers: supabaseHeaders(env) });
    if (!cookResponse.ok) return notFound();
    const cooks = (await cookResponse.json()) as Array<{ avatar_url: string | null }>;
    const path = cooks.length > 0 ? cooks[0].avatar_url : null;
    if (!path) return notFound();

    const signUrl = `${env.SUPABASE_URL}/storage/v1/object/sign/avatars/${path}`;
    const signResponse = await fetch(signUrl, {
      method: "POST",
      headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!signResponse.ok) return notFound();
    const signed = (await signResponse.json()) as { signedURL?: string };
    if (!signed.signedURL) return notFound();

    const imageResponse = await fetch(`${env.SUPABASE_URL}/storage/v1${signed.signedURL}`);
    if (!imageResponse.ok) return notFound();
    return new Response(imageResponse.body, {
      headers: {
        "Content-Type": imageResponse.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return notFound();
  }
}

function rewriteTags(asset: Response, tags: Tags, hasPhoto: boolean, jsonLd: string): Response {
  // The width and height in index.html describe the static 1200x630 card. A proxied recipe
  // photo is whatever shape the cook's camera produced, so keeping them would state a size
  // that is simply wrong and invite a bad crop. Dropping them lets the crawler measure.
  const dropFixedSize = {
    element(element: Element): void {
      if (hasPhoto) element.remove();
    },
  };
  return new HTMLRewriter()
    .on('meta[property="og:image:width"]', dropFixedSize)
    .on('meta[property="og:image:height"]', dropFixedSize)
    .on("title", {
      element(element) {
        // setInnerContent escapes text by default, which is what we want for a title.
        element.setInnerContent(tags.title);
      },
    })
    .on('meta[property="og:title"]', {
      element(element) {
        element.setAttribute("content", tags.title);
      },
    })
    .on('meta[property="og:description"]', {
      element(element) {
        element.setAttribute("content", tags.description);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute("content", tags.description);
      },
    })
    .on('meta[property="og:url"]', {
      element(element) {
        element.setAttribute("content", tags.url);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", tags.url);
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        element.setAttribute("content", tags.image);
      },
    })
    .on('meta[property="og:image:alt"]', {
      element(element) {
        element.setAttribute("content", tags.imageAlt);
      },
    })
    .on("head", {
      element(element) {
        // html: true because jsonLd is already a complete <script> element, and the escaping
        // that matters (the </script> break-out) is done in buildRecipeJsonLd.
        element.append(jsonLd, { html: true });
      },
    })
    .transform(asset);
}

async function enrichRecipePage(request: Request, env: Env, id: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  // Only the SPA shell is worth rewriting; anything else (a 404, a hashed asset) is served
  // as-is.
  if (asset.status !== 200 || !asset.headers.get("content-type")?.includes("text/html")) {
    return asset;
  }

  try {
    const recipe = await fetchRecipe(env, id);
    // No row means the anon read was refused, so the recipe is not public: serve the generic
    // card rather than leaking anything about it.
    if (!recipe) return asset;

    // Three independent round trips, so they run together: serialising them would add latency
    // to every shared recipe link.
    const [hasPhoto, ingredients, steps] = await Promise.all([
      fetchHasPhoto(env, id),
      fetchIngredients(env, id),
      fetchSteps(env, id),
    ]);
    const origin = new URL(request.url).origin;
    const tags = buildTags({
      title: recipe.title,
      story: recipe.story,
      id,
      hasPhoto,
      origin,
    });
    const jsonLd = buildRecipeJsonLd({
      title: recipe.title,
      description: tags.description,
      url: tags.url,
      image: tags.image,
      ingredients: ingredients.map(ingredientLine).filter((line) => line !== ""),
      steps: steps.map((step) => step.text ?? "").filter((text) => text !== ""),
      servings: recipe.servings,
      prepMinutes: recipe.prep_minutes,
      cookMinutes: recipe.cook_minutes,
      // No cheap way to get the author from the recipes table, and a wrong byline is worse
      // than none, so it stays null rather than being invented from a join.
      authorName: null,
    });
    return rewriteTags(asset, tags, hasPhoto, jsonLd);
  } catch {
    // A preview is a nice-to-have; the page load is not. Any Supabase or parsing failure
    // degrades to the untouched asset.
    return asset;
  }
}

// Security headers, added to every response this Worker returns.
//
// The one that does real work is the Content-Security-Policy. Session tokens live in
// localStorage, so an injected script could read a session and act as that person, and since
// a moderator account can list every email and delete accounts, that is the worst case in this
// app. React escapes by default and nothing here uses dangerouslySetInnerHTML, so there is no
// known hole; CSP is the thing that limits the damage of the one nobody has found yet.
//
// Each source is as narrow as the app actually allows:
//   script-src 'self'  - no inline script at all. This is why the theme bootstrap moved out of
//                        index.html into /theme-init.js. Adding an inline <script> anywhere
//                        will silently stop executing, which is the trade for this guarantee.
//   style-src  'unsafe-inline' - unavoidable: several components set a style={{...}} attribute,
//                        and CSP counts those as inline styles. Far weaker than allowing inline
//                        SCRIPT, which is the one that matters.
//   img-src / connect-src - Supabase, because the browser fetches signed photo URLs and talks
//                        to PostgREST, Auth, Storage and Functions directly from the page.
//   frame-ancestors 'none' - nobody may frame this app, which is clickjacking defence and
//                        replaces the older X-Frame-Options.
//
// Deliberately NOT report-only. A report-only policy with no reporting endpoint is a policy
// that does nothing at all, which is worse than none because it reads like protection.

// Every exit from fetch() goes through here, so a new route cannot accidentally ship without
// the headers. That is the whole reason it wraps rather than being added per-response.
function withSecurityHeaders(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders(env.SUPABASE_URL))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await route(request, env), env);
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  {
    const url = new URL(request.url);

    // The bare domain is the marketing surface and answers exactly three things itself.
    // Everything else 302s to the app, which is what the edge redirect rule this replaced did
    // for every path: people hold enamelvault.com/recipes/<id> links. Serving the SPA here
    // instead would put the whole app on a second hostname as duplicate content.
    if (isSiteHost(url.hostname)) {
      if (url.pathname === "/") return serveSite(request, env);
      if (url.pathname === "/robots.txt") {
        return new Response(siteRobots(), {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      }
      if (url.pathname === "/sitemap.xml") {
        return new Response(siteSitemap(), {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      }
      // 302, not 301, for the same reason the bare-domain redirect was a 302 on 2026-09-25: a
      // 301 is cached effectively forever and a decision you may reverse should not be.
      return Response.redirect(`${APP_ORIGIN}${url.pathname}${url.search}`, 302);
    }

    // The raw template is an asset, so it is fetchable by path on either host. It is not a page:
    // on the app host it is a stray one nobody meant to publish, and on the bare host it is this
    // page with its placeholder still in it. serveSite reaches the file through its own internal
    // ASSETS fetch above, so refusing it here costs nothing.
    if (url.pathname === "/site.html") return notFound();

    const pathname = url.pathname;

    // First, and deliberately cheap: an outage check has to answer when the rest is unwell.
    if (pathname === HEALTH_PATH) return checkExtract(env.SUPABASE_URL);

    if (pathname === "/sitemap.xml") return serveSitemap(env, new URL(request.url).origin);

    const ogId = ogIdFromPath(pathname);
    if (ogId) return serveOgImage(env, ogId);

    const avatarHandle = avatarHandleFromPath(pathname);
    if (avatarHandle) return serveAvatar(env, avatarHandle);

    const id = recipeIdFromPath(pathname);
    if (id) return enrichRecipePage(request, env, id);

    return env.ASSETS.fetch(request);
  }
}
