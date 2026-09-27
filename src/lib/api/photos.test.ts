import { vi, test, expect, beforeEach } from "vitest";
const from = vi.fn();
const upload = vi.fn();
const createSignedUrl = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  storage: { from: (...a: any[]) => ({
    upload: (...b: any[]) => upload(...a, ...b),
    createSignedUrl: (...b: any[]) => createSignedUrl(...b),
  }) },
}}));
import { uploadRecipePhoto, getPhotoUrl, forgetPhotoUrls } from "./photos";

// Records what was inserted and what was demoted, and lets .eq()/.neq() chain in any order.
function mockTable() {
  const inserted: any[] = [];
  const demoted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "ph1", ...payload }, error: null }) }) };
    },
    update: (payload: any) => {
      const call: any = { table, payload, filters: {} };
      demoted.push(call);
      const chain: any = {
        eq: (col: string, val: unknown) => { call.filters[col] = val; return chain; },
        neq: (col: string, val: unknown) => { call.filters["not:" + col] = val; return chain; },
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
      return chain;
    },
  }));
  return { inserted, demoted };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  upload.mockResolvedValue({ data: { path: "p" }, error: null });
});

// Note this also pins the shrink fallback: jsdom has no createImageBitmap, so the resize is
// skipped and the ORIGINAL file object must reach storage. A photo that is too big beats a
// photo that never uploaded, so every failure inside shrink() has to degrade to this.
test("uploadRecipePhoto uploads the file then inserts a recipe_photos row", async () => {
  const { inserted } = mockTable();
  const file = new File(["x"], "cover.png", { type: "image/png" });
  const photo = await uploadRecipePhoto("r1", file, true);
  // The long cache-control is half the reason a second view is free; an object at a UUID
  // path is never rewritten, so there is nothing for a stale cache entry to be stale against.
  expect(upload).toHaveBeenCalledWith("recipe-photos", expect.stringContaining("r1/"), file,
    { cacheControl: "31536000" });
  expect(photo.id).toBe("ph1");
  expect(inserted[0].table).toBe("recipe_photos");
  expect(inserted[0].payload.recipe_id).toBe("r1");
  expect(inserted[0].payload.is_cover).toBe(true);
});

// The bug: editing a recipe and picking a photo ADDED a second cover instead of replacing
// the first, so covers piled up and which one showed came down to row order.
test("a new cover demotes the previous ones, excluding itself", async () => {
  const { demoted } = mockTable();
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);
  expect(demoted).toHaveLength(1);
  expect(demoted[0].payload).toEqual({ is_cover: false });
  expect(demoted[0].filters.recipe_id).toBe("r1");
  expect(demoted[0].filters.is_cover).toBe(true);
  // Excluding the row just inserted, or the upload would demote its own cover.
  expect(demoted[0].filters["not:id"]).toBe("ph1");
});

test("a non-cover upload demotes nothing", async () => {
  const { demoted } = mockTable();
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), false);
  expect(demoted).toHaveLength(0);
});

// The bug this pins: createSignedUrl mints a new token every call, a new url is a new cache
// key, and the browser therefore re-downloaded the full image on every single page load.
test("a signed photo url is reused instead of re-signed, so the browser can cache the image", async () => {
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/img?token=a" }, error: null });
  expect(await getPhotoUrl("r1/p")).toBe("https://s/img?token=a");

  // A second load must produce the IDENTICAL url, which is the whole point.
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/img?token=b" }, error: null });
  expect(await getPhotoUrl("r1/p")).toBe("https://s/img?token=a");
  expect(createSignedUrl).toHaveBeenCalledTimes(1);
});

test("a remembered url close to expiry is re-signed rather than handed out dead", async () => {
  localStorage.setItem("photo-url:r1/p", JSON.stringify({ url: "https://s/old", exp: Date.now() + 60_000 }));
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/fresh" }, error: null });
  expect(await getPhotoUrl("r1/p")).toBe("https://s/fresh");
});

test("a corrupt cache entry signs a fresh url rather than throwing", async () => {
  localStorage.setItem("photo-url:r1/p", "not json");
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/fresh" }, error: null });
  expect(await getPhotoUrl("r1/p")).toBe("https://s/fresh");
});

// A remembered url is a bearer token for a private photo, so it must not survive the session.
test("forgetPhotoUrls drops remembered urls without touching anything else", async () => {
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://s/img?token=a" }, error: null });
  await getPhotoUrl("r1/p");
  localStorage.setItem("theme", "dark");

  forgetPhotoUrls();
  expect(localStorage.getItem("photo-url:r1/p")).toBeNull();
  expect(localStorage.getItem("theme")).toBe("dark");
});
