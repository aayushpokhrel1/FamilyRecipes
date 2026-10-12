import type { ReactElement } from "react";
import Cookies from "./pages/Cookies";
import Help from "./pages/Help";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

// The four public documents, rendered to HTML at build time so that a crawler reading
// /help sees the prose rather than an empty <div id="root">.
//
// THIS IS CRAWLER-ONLY OUTPUT. src/main.tsx calls createRoot().render(), not hydrateRoot(),
// so React DISCARDS whatever is already inside #root. There is no hydration contract, which
// is why this file needs no providers and why a stale fragment cannot break the page for a
// person. If main.tsx ever moves to hydrateRoot, that safety argument is void and every
// fragment becomes a potential hydration mismatch: read the spec before changing it.
//
// Each entry carries the page's own h1 so that src/prerender.test.tsx can tell a rendered
// page from a silently empty one. ADDING A PUBLIC DOCUMENT? Add it here and to
// STATIC_SITEMAP_PATHS in worker/meta.ts; the test fails if the two disagree.
export const PRERENDER_PAGES: Record<string, { element: ReactElement; h1: string }> = {
  "/terms": { element: <Terms />, h1: "Terms and acceptable use" },
  "/privacy": { element: <Privacy />, h1: "Privacy policy" },
  "/cookies": { element: <Cookies />, h1: "Cookies and local storage" },
  "/help": { element: <Help />, h1: "Help" },
};
