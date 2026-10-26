import { describe, expect, it } from "vitest";
import { isAdminHost, adminRobots, ADMIN_HOST, ADMIN_ORIGIN, ADMIN_ENTRY } from "./admin";
import { KITCHEN_HOST } from "./kitchen";
import { SITE_HOST } from "./site";

describe("isAdminHost", () => {
  it("matches the console host, in any case", () => {
    expect(isAdminHost(ADMIN_HOST)).toBe(true);
    expect(isAdminHost(ADMIN_HOST.toUpperCase())).toBe(true);
  });

  // THE WHOLE POINT OF THE EXACT MATCH. A suffix test passes for a hostname an attacker owns,
  // and this one decides whether a request is served the moderation console.
  it("refuses a hostname that merely ends with it", () => {
    expect(isAdminHost(`${ADMIN_HOST}.evil.example`)).toBe(false);
    expect(isAdminHost(`not${ADMIN_HOST}`)).toBe(false);
  });

  it("refuses the other three hosts, so no route reaches the wrong app", () => {
    expect(isAdminHost(KITCHEN_HOST)).toBe(false);
    expect(isAdminHost(SITE_HOST)).toBe(false);
    expect(isAdminHost("recipes.enamelvault.com")).toBe(false);
  });
});

describe("adminRobots", () => {
  it("disallows everything", () => {
    const robots = adminRobots();
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /");
    // No Allow line may creep in. On a moderation console there is nothing a crawler should
    // reach, so an exception here would always be a mistake rather than a tuning.
    expect(robots).not.toContain("Allow:");
  });

  it("names no sitemap, because this host must never have one", () => {
    expect(adminRobots().toLowerCase()).not.toContain("sitemap");
  });
});

describe("the entry", () => {
  // It is fetched internally and refused as a public path, exactly as site.html and
  // kitchen.html are, so the filename never appears in a URL anybody sees.
  it("is a built file at the root", () => {
    expect(ADMIN_ENTRY).toBe("/admin.html");
  });

  it("builds its origin from its host", () => {
    expect(ADMIN_ORIGIN).toBe(`https://${ADMIN_HOST}`);
  });
});

// THE COPIES MUST AGREE. The Worker decides which app to SERVE and does not import application
// code to do it; src/lib/hosts.ts decides where a cross-app LINK points. Two copies of a
// hostname drift, so this is the test that stops them: a link to the old host after a rename
// would otherwise land on whatever the registrar is serving.
describe("src/lib/hosts.ts agrees with the Worker", () => {
  it("points its production origins at the same hosts", async () => {
    // THE PROD_ EXPORTS, not the switched ones. `import.meta.env.DEV` is TRUE under Vitest, so
    // ADMIN_ORIGIN here is the localhost string and asserting on it would compare a dev value
    // with a production one, or worse, pass while proving nothing about what ships.
    const hosts = await import("../src/lib/hosts");
    expect(hosts.PROD_ADMIN_ORIGIN).toBe(ADMIN_ORIGIN);
    expect(hosts.PROD_KITCHEN_ORIGIN).toBe(`https://${KITCHEN_HOST}`);
  });
});
