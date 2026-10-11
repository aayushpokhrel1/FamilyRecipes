import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import html from "../../kitchen.html?raw";
import viteConfig from "../../vite.config.ts?raw";
import KitchenRoutes from "./routes";

// Read through Vite's ?raw import, NOT node:fs: tests under src/ compile against
// tsconfig.app.json, whose types are vite/client and vitest/globals with no node types at
// all. src/lib/browserStorage.test.ts reads index.html the same way.
//
// The kitchen app is a SECOND entry in this repo, and the two things most likely to go wrong
// are invisible at runtime: the HTML entry pointing at the wrong module, and the entry being
// placed where Vite copies it verbatim instead of building it.
describe("the kitchen entry", () => {
  it("boots the kitchen app and not the family one", () => {
    expect(html).toContain("/src/kitchen/main.tsx");
    expect(html).not.toContain("/src/main.tsx");
  });

  it("carries no inline script, which the Worker's CSP would silently block", () => {
    // A <script> with a src is fine. A <script> with a body is not.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
  });

  it("tells crawlers to stay away while the product is in development", () => {
    expect(html).toContain('name="robots"');
    expect(html).toContain("noindex");
  });

  it("is listed as a Vite input, or it is never built at all", () => {
    expect(viteConfig).toContain("kitchen.html");
  });
});

describe("the kitchen routes", () => {
  it("renders a signed-out visitor the sign-in page", () => {
    render(
      <MemoryRouter initialEntries={["/signin"]}>
        <KitchenRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("has a route for an invite link, reachable without a session", () => {
    render(
      <MemoryRouter initialEntries={["/join/abc123"]}>
        <KitchenRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("heading", { name: /sign in/i })).not.toBeInTheDocument();
  });
});
