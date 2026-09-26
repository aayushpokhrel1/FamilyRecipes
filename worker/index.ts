// The site was served straight from static assets until now. This Worker sits in front so
// that /recipes/:id can carry its own OpenGraph tags: a crawler does not run the SPA, so
// anything it should see has to be in the HTML before it is served.
//
// Everything not explicitly handled falls through to the assets binding untouched, which is
// exactly what the assets-only config did before. Keep it that way: a recipe page must never
// fail to load because a preview could not be built.
import { buildTags, ogIdFromPath, recipeIdFromPath, type Tags } from "./meta";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type RecipeRow = { title: string; story: string | null };
type PhotoRow = { storage_path: string | null; is_cover: boolean | null };

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
  const url = `${env.SUPABASE_URL}/rest/v1/recipes?id=eq.${id}&select=title,story&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders(env) });
  if (!response.ok) return null;

  const rows = (await response.json()) as RecipeRow[];
  return rows.length > 0 ? rows[0] : null;
}

async function fetchHasPhoto(env: Env, id: string): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/recipe_photos?recipe_id=eq.${id}&select=id&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders(env) });
  if (!response.ok) return false;

  const rows = (await response.json()) as unknown[];
  return rows.length > 0;
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

function rewriteTags(asset: Response, tags: Tags): Response {
  return new HTMLRewriter()
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

    const hasPhoto = await fetchHasPhoto(env, id);
    const tags = buildTags({
      title: recipe.title,
      story: recipe.story,
      id,
      hasPhoto,
      origin: new URL(request.url).origin,
    });
    return rewriteTags(asset, tags);
  } catch {
    // A preview is a nice-to-have; the page load is not. Any Supabase or parsing failure
    // degrades to the untouched asset.
    return asset;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    const ogId = ogIdFromPath(pathname);
    if (ogId) return serveOgImage(env, ogId);

    const id = recipeIdFromPath(pathname);
    if (id) return enrichRecipePage(request, env, id);

    return env.ASSETS.fetch(request);
  },
};
