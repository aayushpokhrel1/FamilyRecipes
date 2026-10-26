// Where the three apps live, for the links that hop between them.
//
// The Worker has its own copies of these hostnames in `worker/site.ts`, `worker/kitchen.ts` and
// `worker/admin.ts`, and that duplication is deliberate rather than sloppy: the Worker decides
// which app to SERVE and must not import application code to do it, while this file decides
// where a link POINTS. `worker/admin.test.ts` asserts the two agree, so the copies cannot drift
// without a test going red.
//
// DEV POINTS AT THE DEV SERVER, and this is not a nicety. A link to
// https://kitchen.enamelvault.com from a local dev server navigates away from what you are
// working on, and this project has learned repeatedly that an app which cannot be walked in dev
// is where the real defects hide. `vite.config.ts` maps kitchen.localhost and admin.localhost to
// the right shells so these work exactly as they do in production.
// THE PRODUCTION ORIGINS ARE EXPORTED SEPARATELY, and not for tidiness.
//
// `import.meta.env.DEV` is TRUE under Vitest, so a test importing the switched values below
// gets the localhost ones and can say nothing at all about what ships. The first version of
// this file had only the switched exports and the cross-check against the Worker failed on
// exactly that, which is the useful version of this mistake: it failed loudly rather than
// quietly asserting the dev strings matched the dev strings.
export const PROD_FAMILY_ORIGIN = "https://recipes.enamelvault.com";
export const PROD_KITCHEN_ORIGIN = "https://kitchen.enamelvault.com";
export const PROD_ADMIN_ORIGIN = "https://admin.enamelvault.com";

const DEV = import.meta.env.DEV;

// The port the dev server actually runs on. 5174 rather than Vite's default 5173 because that
// is the port in Supabase's redirect allow list, and an OAuth round trip from another port
// silently lands on the Site URL instead.
const DEV_PORT = 5174;

export const FAMILY_ORIGIN = DEV ? `http://localhost:${DEV_PORT}` : PROD_FAMILY_ORIGIN;
export const KITCHEN_ORIGIN = DEV ? `http://kitchen.localhost:${DEV_PORT}` : PROD_KITCHEN_ORIGIN;
export const ADMIN_ORIGIN = DEV ? `http://admin.localhost:${DEV_PORT}` : PROD_ADMIN_ORIGIN;
