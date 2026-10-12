// @vitest-environment node
// The kitchen's record of who accepted which terms, at the database level.
//
// RLS IS THE WHOLE GUARD HERE. There is deliberately no SECURITY DEFINER function in front of
// this table, so unlike every other kitchen write there is no function body to check a role:
// the policies are the only thing standing between one person's acceptance and another's.
//
// What the row is FOR is the reason this matters. It is the evidence that a named person
// agreed to a named version. If somebody else can write it, it is evidence of nothing, and the
// failure would be silent: the app would carry on showing the gate to nobody.
import { describe, expect, it } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);

describe("a kitchen terms acceptance", () => {
  it("is reachable at all, which the hosted project needs a manual setting for", async () => {
    // If this fails with a 404 or "schema must be one of", the schema is not exposed: locally
    // add it to supabase/config.toml, on the hosted project set it in Settings -> API ->
    // Exposed schemas BY HAND. No migration does it, and the whole suite stays green while
    // every kitchen call on that host fails.
    const staff = await makeUser(`kterms-reach-${stamp()}@t.dev`);
    const { error } = await staff.client.schema("kitchen").from("terms_acceptance").select("version").limit(1);
    expect(error).toBeNull();
  });

  it("records and reads back the accepting user's own row", async () => {
    const staff = await makeUser(`kterms-mine-${stamp()}@t.dev`);
    const { error: writeError } = await staff.client
      .schema("kitchen")
      .from("terms_acceptance")
      .upsert({ user_id: staff.id, version: "2026-10-11" });
    expect(writeError).toBeNull();

    const { data } = await staff.client
      .schema("kitchen")
      .from("terms_acceptance")
      .select("version,accepted_at")
      .eq("user_id", staff.id);
    expect(data).toHaveLength(1);
    expect(data![0].version).toBe("2026-10-11");
  });

  it("hides one person's acceptance from another", async () => {
    // Zero rows rather than an error, because that is what a select policy does: the reader is
    // not told the row exists. Either way they must not see the version.
    const mine = await makeUser(`kterms-a-${stamp()}@t.dev`);
    const other = await makeUser(`kterms-b-${stamp()}@t.dev`);
    await mine.client
      .schema("kitchen")
      .from("terms_acceptance")
      .upsert({ user_id: mine.id, version: "2026-10-11" });

    const { data } = await other.client
      .schema("kitchen")
      .from("terms_acceptance")
      .select("version")
      .eq("user_id", mine.id);
    expect(data).toEqual([]);
  });

  it("refuses to let one person accept on another's behalf", async () => {
    // The forgery that would matter: a row saying somebody agreed when they never saw the page.
    const victim = await makeUser(`kterms-victim-${stamp()}@t.dev`);
    const forger = await makeUser(`kterms-forger-${stamp()}@t.dev`);

    const { error } = await forger.client
      .schema("kitchen")
      .from("terms_acceptance")
      .upsert({ user_id: victim.id, version: "never-read-this" });
    expect(error).not.toBeNull();

    // And nothing landed, checked with the service role so RLS cannot hide a row that exists.
    const { data } = await admin
      .schema("kitchen")
      .from("terms_acceptance")
      .select("version")
      .eq("user_id", victim.id);
    expect(data).toEqual([]);
  });

  it("refuses an acceptance from a stranger with no session at all", async () => {
    // The anon key ships in the JS bundle on purpose, so "signed out" is a real caller here
    // rather than a hypothetical one.
    const { error } = await anonClient()
      .schema("kitchen")
      .from("terms_acceptance")
      .upsert({ user_id: crypto.randomUUID(), version: "2026-10-11" });
    expect(error).not.toBeNull();
  });
});
