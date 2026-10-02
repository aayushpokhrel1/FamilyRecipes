// Sets the theme before first paint, so the page never flashes light and then goes dark.
//
// This is a SEPARATE FILE rather than an inline <script> for one reason: the Content-Security
// Policy the Worker sends uses script-src 'self', which blocks inline script. The alternative
// was allowing this one script by its SHA-256 hash, but dist/ is gitignored, so nothing could
// test that the hash still matched what Vite actually emitted, and a stale hash fails by
// silently blocking the script and flashing the wrong theme on every cold load.
//
// It lives in public/ so Vite copies it verbatim to /theme-init.js instead of bundling and
// fingerprinting it, which keeps the path stable for the blocking <script> tag in index.html.
// Keep the key and the values in sync with src/lib/theme.ts.
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored === "dark" || (stored !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
