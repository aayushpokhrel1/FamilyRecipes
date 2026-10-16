// What a real database does with activity_days and credit_signup_source, run as an ordinary
// user and as anon. The static checks in supabase/rls.test.ts prove a policy EXISTS; only
// this can tell a correct policy from a present one.
//
// NOTHING HERE ASSERTS THROUGH `admin`. The service role bypasses RLS, so an assertion made
// with it passes however broken the policy is. It is used only to set a row up, to age a
// created_at that no client can move, and to observe a cascade, which is not a policy.
import { beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

// A surface nobody should be able to store. It is built rather than written inline so this
// file carries no stray quoting, and the value is what a careless free-text column would let
// a signed-in caller put straight into the moderator's panel.
const BAD_SURFACE = String.fromCharCode(39) + "; drop table activity_days; --";

function rand() {
  return Math.random().toString(36).slice(2, 10);
}

function localToday(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

describe("activity_days", () => {
  let cook: Awaited<ReturnType<typeof makeUser>>;
  let other: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    cook = await makeUser(`activity-${rand()}@example.com`);
    other = await makeUser(`activity-${rand()}@example.com`);
  });

  it("lets a cook record their own visit, naming no cook", async () => {
    // THE EXACT CALL src/lib/api/activity.ts MAKES. The function reads auth.uid() itself.
    const { error } = await cook.client.rpc("record_visit", {
      p_day: localToday(),
      p_surface: "potluck",
    });
    expect(error).toBeNull();
  });

  it("REFUSES a client upsert, which is why the write goes through the function", async () => {
    // THIS IS THE TEST THAT FOUND THE DESIGN. `on conflict` makes Postgres look at the
    // conflicting row to decide whether there is one, so it needs a select policy, and this
    // table deliberately has none. The result is 42501 for a cook writing their OWN row with
    // the id filled in correctly. Pinned so the collision is recorded as behaviour rather
    // than only in a comment.
    const { error } = await cook.client
      .from("activity_days")
      .upsert(
        { user_id: cook.id, day: localToday(), surface: "settings" },
        { onConflict: "user_id,day,surface", ignoreDuplicates: true },
      );
    expect(error?.code).toBe("42501");
  });

  it("refuses a surface outside the list, so the panel cannot be filled with anything", async () => {
    // The function bypasses RLS, so it is the real boundary: without this check p_surface is a
    // free-text column a signed-in caller writes at will.
    const { error } = await cook.client.rpc("record_visit", {
      p_day: localToday(),
      p_surface: BAD_SURFACE,
    });
    // A no-op rather than an exception, because this is called on every navigation.
    expect(error).toBeNull();

    const { data } = await admin
      .from("activity_days")
      .select("surface")
      .eq("user_id", cook.id)
      .eq("surface", BAD_SURFACE);
    expect(data ?? []).toEqual([]);
  });

  it("is idempotent, so a cook moving around the app raises nothing", async () => {
    const args = { p_day: localToday(), p_surface: "recipes" };
    const first = await cook.client.rpc("record_visit", args);
    const second = await cook.client.rpc("record_visit", args);
    expect(first.error).toBeNull();
    // `on conflict do nothing` inside the function. A plain insert would raise a duplicate-key
    // error on the second navigation to the same surface on the same day.
    expect(second.error).toBeNull();
  });

  it("REFUSES a row attributed to somebody else", async () => {
    // An insert that violates a policy RAISES, unlike an update or delete, which match zero
    // rows and resolve with error null. That difference is why this assertion can be made on
    // the error rather than on a row count.
    const { error } = await cook.client
      .from("activity_days")
      .insert({ user_id: other.id, day: localToday(), surface: "potluck" });
    expect(error).not.toBeNull();
    // Through the function there is no id to substitute at all, which is the stronger
    // property: it reads the cook from auth.uid(), so the parameter does not exist.
  });

  it("REFUSES a forged date, so a retention history cannot be invented", async () => {
    // The day is the client's local date by design, which makes it client-supplied input. RLS
    // permits this row because it IS the cook's row, so the check constraint is the only thing
    // standing between that and a fabricated year of use.
    // Through the function: a no-op, because a measurement must not raise.
    await cook.client.rpc("record_visit", { p_day: localToday(-30), p_surface: "cupboard" });
    await cook.client.rpc("record_visit", { p_day: localToday(30), p_surface: "cupboard" });
    const { data } = await admin
      .from("activity_days")
      .select("day")
      .eq("user_id", cook.id)
      .eq("surface", "cupboard");
    expect(data ?? []).toEqual([]);

    // And directly, where the column's check constraint is what refuses it.
    const { error } = await cook.client
      .from("activity_days")
      .insert({ user_id: cook.id, day: localToday(-30), surface: "potluck" });
    expect(error).not.toBeNull();
  });

  it("lets NOBODY read it, not even the cook who wrote the row", async () => {
    // There is deliberately no select policy. A select with no policy is not an error: it
    // matches nothing and resolves with error null and an empty array, which is exactly what
    // has to be asserted here. A test expecting an error would pass for the wrong reason.
    const mine = await cook.client.from("activity_days").select("day, surface");
    expect(mine.error).toBeNull();
    expect(mine.data).toEqual([]);

    const theirs = await other.client.from("activity_days").select("day, surface");
    expect(theirs.data).toEqual([]);

    const stranger = await anonClient().from("activity_days").select("day, surface");
    expect(stranger.data ?? []).toEqual([]);
  });

  it("is still holding the rows it accepted, which the reads above could not show", async () => {
    // Observed with the service role ON PURPOSE, and this is the one thing it is for here: the
    // previous test proves nobody can read the table, so without this the whole suite would
    // also pass if the writes had silently failed.
    const { data } = await admin
      .from("activity_days")
      .select("surface")
      .eq("user_id", cook.id);
    expect((data ?? []).map((r) => r.surface).sort()).toEqual(["potluck", "recipes"]);
  });
});

describe("credit_signup_source", () => {
  it("credits an account that was just created", async () => {
    const cook = await makeUser(`credit-${rand()}@example.com`);
    const { error } = await cook.client.rpc("credit_signup_source", { p_source: "family" });
    expect(error).toBeNull();

    // Read as the cook, through profiles_self_read, never through admin.
    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    expect(data?.signup_source).toBe("family");
  });

  it("never overwrites a credit, so it records the FIRST arrival", async () => {
    const cook = await makeUser(`credit-${rand()}@example.com`);
    await cook.client.rpc("credit_signup_source", { p_source: "hub" });
    await cook.client.rpc("credit_signup_source", { p_source: "professional" });

    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    expect(data?.signup_source).toBe("hub");
  });

  it("refuses a value outside the three, rather than storing it or raising", async () => {
    const cook = await makeUser(`credit-${rand()}@example.com`);
    const { error } = await cook.client.rpc("credit_signup_source", {
      p_source: "'; drop table profiles; --",
    });
    // A no-op, not an exception: the function returns early, so a hostile parameter cannot be
    // told apart from an unrecognised one by the caller.
    expect(error).toBeNull();

    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    expect(data?.signup_source).toBeNull();
  });

  it("still credits an account confirmed hours later, which is the normal email flow", async () => {
    // THE CASE A BROWSER WALK FOUND. The credit is written when the layout first mounts, which
    // is after the email confirmation link is opened and after the terms gate is accepted, and
    // a confirmation link is opened whenever the person gets to it. An earlier version of this
    // function used a ten-minute window, which passed for a Google signup and would have
    // silently never fired for an email one.
    const cook = await makeUser(`credit-${rand()}@example.com`);
    await admin
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 8 * 3600_000).toISOString() })
      .eq("id", cook.id);

    await cook.client.rpc("credit_signup_source", { p_source: "family" });

    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    expect(data?.signup_source).toBe("family");
  });

  it("refuses an established account, which is what makes the number mean anything", async () => {
    const cook = await makeUser(`credit-${rand()}@example.com`);
    // Aged with the service role because no client can move created_at, which is the point:
    // now() inside the function is the one clock the caller cannot reach.
    await admin
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 40 * 86400_000).toISOString() })
      .eq("id", cook.id);

    await cook.client.rpc("credit_signup_source", { p_source: "family" });

    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    // The marketing pages link to /signin as well as /signup, so without this an established
    // cook arriving through a marketing link would be counted as an account it produced, as
    // would every account that predates the feature, since all of their sources are null.
    expect(data?.signup_source).toBeNull();
  });

  it("cannot be reached by a stranger, who has no account to credit", async () => {
    const { error } = await anonClient().rpc("credit_signup_source", { p_source: "family" });
    // Execute is revoked from anon, so this is refused outright rather than running as a
    // no-op. Either way nothing is written; the assertion is that it is not a route in.
    expect(error).not.toBeNull();
  });

  it("cannot be reached by a cook updating their own profile directly", async () => {
    // The column is deliberately NOT in profiles_self_update's with check. A cook may update
    // their own profile, so if widening that policy had been the answer, this would succeed
    // and the ten-minute rule would be decoration.
    const cook = await makeUser(`credit-${rand()}@example.com`);
    await admin
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 40 * 86400_000).toISOString() })
      .eq("id", cook.id);

    await cook.client.from("profiles").update({ signup_source: "family" }).eq("id", cook.id);

    const { data } = await cook.client
      .from("profiles")
      .select("signup_source")
      .eq("id", cook.id)
      .single();
    expect(data?.signup_source).toBeNull();
  });
});

describe("deleting an account that has been measured", () => {
  it("is not vetoed by the activity rows, and takes them with it", async () => {
    const cook = await makeUser(`delete-${rand()}@example.com`);
    await cook.client.rpc("record_visit", { p_day: localToday(), p_surface: "cookmode" });

    // The failure this guards against is NO ACTION on the foreign key, which refuses the
    // delete. delete-account blanks the profile FIRST and removes the login LAST, so the
    // refusal would land with the identity already erased and the login still live.
    const { error } = await admin.auth.admin.deleteUser(cook.id);
    // A NO ACTION foreign key would refuse this outright.
    expect(error).toBeNull();

    // The cascade is schema behaviour, not a policy, so the service role observes it correctly.
    const { data } = await admin
      .from("activity_days")
      .select("surface")
      .eq("user_id", cook.id);
    expect(data ?? []).toEqual([]);
  });
});

describe("record_visit is not a route in for a stranger", () => {
  it("refuses anon outright rather than running as a no-op", async () => {
    // Execute is revoked from anon. The function would return early on a null auth.uid()
    // anyway, so this is belt and braces; the point is that it is not a route in.
    const { error } = await anonClient().rpc("record_visit", {
      p_day: localToday(),
      p_surface: "potluck",
    });
    expect(error).not.toBeNull();
  });
});
