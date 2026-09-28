import { vi, test, expect, beforeEach } from "vitest";
const from = vi.fn();
const getUser = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: (...a: any[]) => getUser(...a) },
}}));
import { follow, unfollow, isFollowing, listFollowedCookIds } from "./follows";

const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: "me" } } });
const signedOut = () => getUser.mockResolvedValue({ data: { user: null } });

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
});

test("follow sends both ids, so the row carries the value RLS only guards", async () => {
  signedIn();
  let inserted: any;
  from.mockImplementation(() => ({
    insert: (row: any) => { inserted = row; return { error: null }; },
  }));
  await follow("cook1");
  expect(inserted).toEqual({ follower_id: "me", cook_id: "cook1" });
});

test("unfollow filters on both columns, not just the follower", async () => {
  signedIn();
  const eqs: Array<[string, string]> = [];
  const builder: any = { eq: (c: string, v: string) => { eqs.push([c, v]); return builder; } };
  from.mockImplementation(() => ({ delete: () => builder }));
  await unfollow("cook1");
  expect(eqs).toEqual([["follower_id", "me"], ["cook_id", "cook1"]]);
});

test("listFollowedCookIds returns the ids", async () => {
  signedIn();
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ data: [{ cook_id: "a" }, { cook_id: "b" }], error: null }) }),
  }));
  expect(await listFollowedCookIds()).toEqual(["a", "b"]);
});

test("reads return empty when signed out, and make no request", async () => {
  // A visitor is an ordinary state on a page that asks this on render, not an error.
  signedOut();
  expect(await listFollowedCookIds()).toEqual([]);
  expect(await isFollowing("cook1")).toBe(false);
  expect(from).not.toHaveBeenCalled();
});

test("writes throw when signed out", async () => {
  signedOut();
  await expect(follow("cook1")).rejects.toThrow("Not signed in");
  await expect(unfollow("cook1")).rejects.toThrow("Not signed in");
  expect(from).not.toHaveBeenCalled();
});

test("isFollowing is false when there is no row", async () => {
  signedIn();
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => ({ data: null, error: null }) }) }) }),
  }));
  expect(await isFollowing("cook1")).toBe(false);
});
