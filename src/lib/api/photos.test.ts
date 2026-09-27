import { vi, test, expect, beforeEach } from "vitest";
const from = vi.fn();
const upload = vi.fn();
const createSignedUrl = vi.fn();
const remove = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  storage: { from: (...a: any[]) => ({
    upload: (...b: any[]) => upload(...a, ...b),
    createSignedUrl: (...b: any[]) => createSignedUrl(...b),
    remove: (...b: any[]) => remove(...b),
  }) },
}}));
import { uploadRecipePhoto, getPhotoUrl, forgetPhotoUrls } from "./photos";

// Records what was inserted, what the replace path looked for, and what it deleted. Filters
// are collected by name so .eq()/.neq()/.in() may chain in any order.
function mockTable(existingCovers: any[] = []) {
  const inserted: any[] = [];
  const selected: any[] = [];
  const deleted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "ph1", ...payload }, error: null }) }) };
    },
    select: (cols: string) => {
      const call: any = { table, cols, filters: {} };
      selected.push(call);
      const chain: any = {
        eq: (col: string, val: unknown) => { call.filters[col] = val; return chain; },
        neq: (col: string, val: unknown) => { call.filters["not:" + col] = val; return chain; },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: existingCovers, error: null }),
      };
      return chain;
    },
    delete: () => {
      const call: any = { table, filters: {} };
      deleted.push(call);
      const chain: any = {
        in: (col: string, vals: unknown) => { call.filters["in:" + col] = vals; return chain; },
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
      return chain;
    },
  }));
  return { inserted, selected, deleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  upload.mockResolvedValue({ data: { path: "p" }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
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
// the first, so covers piled up and which one showed came down to row order. Demoting fixed
// which one SHOWED but kept the row and the stored file forever, so replacing now deletes.
test("a new cover deletes the previous ones, row and stored file, excluding itself", async () => {
  const { selected, deleted } = mockTable([{ id: "old1", storage_path: "r1/old1" }]);
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);

  expect(selected[0].filters.recipe_id).toBe("r1");
  expect(selected[0].filters.is_cover).toBe(true);
  // Excluding the row just inserted, or the upload would delete its own cover.
  expect(selected[0].filters["not:id"]).toBe("ph1");

  expect(deleted).toHaveLength(1);
  expect(deleted[0].filters["in:id"]).toEqual(["old1"]);
  expect(remove).toHaveBeenCalledWith(["r1/old1"]);
});

// The order matters: an unreferenced file is invisible waste, while a row pointing at a
// deleted file is a broken image on the card. So the row must go first.
test("the row is deleted before the stored file", async () => {
  const order: string[] = [];
  mockTable([{ id: "old1", storage_path: "r1/old1" }]);
  const realDelete = from.getMockImplementation()!;
  from.mockImplementation((table: string) => {
    const api = realDelete(table);
    return { ...api, delete: () => { order.push("row"); return api.delete(); } };
  });
  remove.mockImplementation(() => { order.push("file"); return Promise.resolve({ error: null }); });

  await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);
  expect(order).toEqual(["row", "file"]);
});

// A storage failure must not fail the save: the cook's photo IS replaced, and the leftover
// bytes are not their problem to see an error about.
test("a failed storage removal leaves the replacement successful", async () => {
  mockTable([{ id: "old1", storage_path: "r1/old1" }]);
  remove.mockResolvedValue({ data: null, error: { message: "nope" } });
  const photo = await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);
  expect(photo.id).toBe("ph1");
});

test("with no previous cover, nothing is deleted", async () => {
  const { deleted } = mockTable([]);
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);
  expect(deleted).toHaveLength(0);
  expect(remove).not.toHaveBeenCalled();
});

test("a non-cover upload deletes nothing", async () => {
  const { selected, deleted } = mockTable([{ id: "old1", storage_path: "r1/old1" }]);
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), false);
  expect(selected).toHaveLength(0);
  expect(deleted).toHaveLength(0);
  expect(remove).not.toHaveBeenCalled();
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
