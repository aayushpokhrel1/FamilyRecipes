import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../supabaseClient";
import { fromRow, toRow, listDrafts, getDraft, saveDraft, saveEditDraft, publishEdit, deleteDraft } from "./drafts";
import type { RecipeDraft } from "./types";

vi.mock("../supabaseClient", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
}));

const draft: RecipeDraft = {
  title: "Dal",
  story: "Grandma's",
  provenance: "handwritten card",
  servings: 4,
  prep_minutes: 10,
  cook_minutes: 30,
  ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "dal" }],
  steps: [{ position: 0, text: "Boil" }],
  source_url: "https://example.com/dal",
};

const row = {
  id: "d1",
  author_id: "u1",
  target_family_id: "f1",
  target_recipe_id: null,
  title: "Dal",
  body: {
    story: "Grandma's",
    provenance: "handwritten card",
    servings: 4,
    prep_minutes: 10,
    cook_minutes: 30,
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "dal" }],
    steps: [{ position: 0, text: "Boil" }],
    source_url: "https://example.com/dal",
    visibility: "family",
  },
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

// A chainable stand-in for the PostgREST builder: every method returns itself and the
// terminal await resolves to the canned result.
function chain(result: any) {
  const q: any = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "order", "single"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toRow and fromRow", () => {
  it("round-trips every field", () => {
    const saved = fromRow({ ...row, ...toRow(draft, "family") });
    expect(saved.draft).toEqual(draft);
    expect(saved.visibility).toBe("family");
    expect(saved.id).toBe("d1");
    expect(saved.author_id).toBe("u1");
    expect(saved.target_family_id).toBe("f1");
    expect(saved.target_recipe_id).toBeNull();
    expect(saved.created_at).toBe(row.created_at);
    expect(saved.updated_at).toBe(row.updated_at);
    expect(saved.base_updated_at).toBeNull();
  });

  it("fills defaults for a body written by an older version", () => {
    const saved = fromRow({ ...row, body: {} });
    expect(saved.draft.ingredients).toEqual([]);
    expect(saved.draft.steps).toEqual([]);
    expect(saved.draft.story).toBe("");
    expect(saved.draft.provenance).toBe("");
    expect(saved.draft.servings).toBeNull();
    expect(saved.draft.prep_minutes).toBeNull();
    expect(saved.draft.cook_minutes).toBeNull();
    expect(saved.draft.source_url).toBeNull();
    expect(saved.visibility).toBe("private");
    expect(saved.draft.title).toBe("Dal");
  });

  it("takes title from the column, never from body", () => {
    const saved = fromRow({ ...row, title: "Column title", body: { title: "Body title" } });
    expect(saved.draft.title).toBe("Column title");
  });
});

describe("listDrafts", () => {
  it("orders by updated_at descending and maps rows", async () => {
    const q = chain({ data: [row], error: null });
    (supabase.from as any).mockReturnValue(q);
    const out = await listDrafts();
    expect(supabase.from).toHaveBeenCalledWith("recipe_drafts");
    expect(q.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(out).toHaveLength(1);
    expect(out[0].draft.title).toBe("Dal");
  });
});

describe("getDraft", () => {
  it("selects by id and returns one draft", async () => {
    const q = chain({ data: row, error: null });
    (supabase.from as any).mockReturnValue(q);
    const out = await getDraft("d1");
    expect(q.eq).toHaveBeenCalledWith("id", "d1");
    expect(q.single).toHaveBeenCalled();
    expect(out.id).toBe("d1");
  });
});

describe("saveDraft", () => {
  it("inserts when there is no id", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "u1" } } });
    const q = chain({ data: { id: "new" }, error: null });
    (supabase.from as any).mockReturnValue(q);
    const id = await saveDraft(draft, "f1", "family");
    expect(id).toBe("new");
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({
      author_id: "u1", target_family_id: "f1", title: "Dal",
    }));
    expect(q.update).not.toHaveBeenCalled();
  });

  it("updates when there is an id", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "u1" } } });
    const q = chain({ data: null, error: null });
    (supabase.from as any).mockReturnValue(q);
    const id = await saveDraft(draft, "f1", "private", "d1");
    expect(id).toBe("d1");
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Dal", updated_at: expect.any(String),
    }));
    expect(q.eq).toHaveBeenCalledWith("id", "d1");
    expect(q.insert).not.toHaveBeenCalled();
  });

  it("throws when not signed in", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null } });
    await expect(saveDraft(draft, "f1", "private")).rejects.toThrow("Not signed in");
  });
});

describe("deleteDraft", () => {
  it("deletes the right id", async () => {
    const q = chain({ data: null, error: null });
    (supabase.from as any).mockReturnValue(q);
    await deleteDraft("d1");
    expect(supabase.from).toHaveBeenCalledWith("recipe_drafts");
    expect(q.delete).toHaveBeenCalled();
    expect(q.eq).toHaveBeenCalledWith("id", "d1");
  });
});

describe("saveEditDraft", () => {
  it("inserts with the target recipe and the base updated_at", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "u1" } } });
    const q = chain({ data: { id: "new" }, error: null });
    (supabase.from as any).mockReturnValue(q);
    const id = await saveEditDraft("r1", draft, "f1", "family", "2024-01-01T00:00:00Z");
    expect(id).toBe("new");
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({
      author_id: "u1",
      target_family_id: "f1",
      target_recipe_id: "r1",
      base_updated_at: "2024-01-01T00:00:00Z",
      title: "Dal",
    }));
  });

  it("updates when there is an id", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "u1" } } });
    const q = chain({ data: null, error: null });
    (supabase.from as any).mockReturnValue(q);
    const id = await saveEditDraft("r1", draft, "f1", "private", "2024-01-01T00:00:00Z", "d1");
    expect(id).toBe("d1");
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({
      target_recipe_id: "r1",
      base_updated_at: "2024-01-01T00:00:00Z",
      updated_at: expect.any(String),
    }));
    expect(q.insert).not.toHaveBeenCalled();
  });
});

describe("publishEdit", () => {
  it("calls the RPC and returns the recipe id", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: "r1", error: null });
    const id = await publishEdit("d1");
    expect(supabase.rpc).toHaveBeenCalledWith("publish_recipe_edit", { p_draft: "d1", p_force: false });
    expect(id).toBe("r1");
  });

  it("passes force through", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: "r1", error: null });
    await publishEdit("d1", true);
    expect(supabase.rpc).toHaveBeenCalledWith("publish_recipe_edit", { p_draft: "d1", p_force: true });
  });

  // The translation lives here so no component has to know a Postgres SQLSTATE. A page that
  // branched on 'DRF01' would spread database detail through the UI.
  it("translates DRF01 into an error named RecipeMoved", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { code: "DRF01", message: "recipe moved" } });
    await expect(publishEdit("d1")).rejects.toMatchObject({ name: "RecipeMoved" });
  });

  it("throws any other error as it is", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(publishEdit("d1")).rejects.toThrow("permission denied");
  });
});
