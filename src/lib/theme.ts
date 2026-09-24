// Theme is a per-device choice, deliberately NOT stored in the database: it has to
// apply before the session loads, and the inline script in index.html reads the same
// localStorage key before first paint. Keep the key and the values in sync with it.

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage throws in some privacy modes; fall through to the system default.
  }
  return "system";
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not being able to remember the choice is not a reason to fail to apply it.
  }
  const dark = choice === "dark" || (choice === "system" && prefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
