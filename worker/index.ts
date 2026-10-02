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
  type SitemapEntry,
  type Tags,
} from "./meta";

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

// The static pages are hard-coded because they are the same five for every deployment, and
// they carry no lastmod: there is no per-page timestamp to report and a made-up one would
// teach Google to distrust the field.
const STATIC_SITEMAP_PATHS = ["/", "/terms", "/privacy", "/cookies", "/help"];

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

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
  },
};
