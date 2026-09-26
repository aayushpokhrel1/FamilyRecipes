// The site was served straight from static assets until now. This Worker sits in front so
// that /recipes/:id can carry its own OpenGraph tags: a crawler does not run the SPA, so
// anything it should see has to be in the HTML before it is served.
//
// Everything not explicitly handled falls through to the assets binding untouched, which is
// exactly what the assets-only config did before. Keep it that way: a recipe page must never
// fail to load because a preview could not be built.
export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
