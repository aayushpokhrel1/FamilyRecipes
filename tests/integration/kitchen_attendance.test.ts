// @vitest-environment node
//
// WHAT THIS FILE PINS: the kitchen keeps a dated record of who used which surface, and that
// record is invisible to everybody, including the person it is about.
//
// `kitchen.record_kitchen_visit(p_org, p_day, p_surface)` writes one row into
// `kitchen.activity_days` per (org, user, day, surface). A repeat visit on the same day for the
// same surface is a no-op rather than a second row, a stranger's call fails quietly instead of
// loudly, and a day far in the past or an unknown surface writes nothing at all.
//
// NOBODY MAY SELECT FROM `kitchen.activity_days`. It has RLS on and no select policy for any
// role, so the table is write-only by design. That shapes every assertion below:
//
//   - To OBSERVE whether a row landed, this file reads through the `admin` client, which holds
//     the service role and bypasses RLS. That is legitimate here: it is reading state, not
//     proving a policy.
//   - To PROVE A REFUSAL, this file always uses an ordinary user's client. A refusal asserted
//     through `admin` would pass however broken the policy is, because the service role
//     bypasses RLS and never refuses.
//
// The function does not exist yet, so this file is expected to fail until it does.
import { describe, it, expect } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
const kitchen = (c: Awaited<ReturnType<typeof makeUser>>["client"]) => c.schema("kitchen");

type Client = Awaited<ReturnType<typeof makeUser>>["client"];

// Today as a local YYYY-MM-DD string. Never toISOString(): that converts to UTC first, so for
// anybody east or west of Greenwich it names the wrong day for part of every day.
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function newOrg(owner: Client, name: string) {
  const { data } = await kitchen(owner).rpc("create_org", {
    p_name: name,
    p_display_name: "Sam",
  });
  return data as string;
}


// The only way to see whether a row landed. `org_id` and not `id` in the select list: the table
// has no `id` column, and PostgREST parses the select list even when `head` means no rows come
// back.
async function countFor(orgId: string, userId: string) {
  const { count } = await admin
    .schema("kitchen")
    .from("activity_days")
    .select("org_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  return count;
}

async function countForOrg(orgId: string) {
  const { count } = await admin
    .schema("kitchen")
    .from("activity_days")
    .select("org_id", { count: "exact", head: true })
    .eq("org_id", orgId);
  return count;
}

describe("the kitchen's dated record of use", () => {
  it("a staff member's visit is recorded", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Attendance Group");

    const { error } = await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    expect(error).toBeNull();
    expect(await countFor(orgId, owner.id)).toBe(1);
  });

  it("a second visit the same day for the same surface adds no row", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Repeat Attendance Group");

    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    const { error } = await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    // A repeat is a quiet no-op, not an error the caller has to swallow.
    expect(error).toBeNull();
    expect(await countFor(orgId, owner.id)).toBe(1);
  });

  it("two surfaces on the same day are two rows", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Two Surface Group");

    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "sites",
    });
    expect(await countFor(orgId, owner.id)).toBe(2);
  });

  it("a non-member's call records nothing and does not raise", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Closed Attendance Group");
    const stranger = await makeUser(`kit-att-stranger-${stamp()}@t.dev`);

    const { error } = await kitchen(stranger.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    // Both halves matter: it must fail quietly, not loudly, and it must not write.
    expect(error).toBeNull();
    expect(await countFor(orgId, stranger.id)).toBe(0);
  });

  it("anon cannot execute it at all", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Anon Attendance Group");

    // anonClient has the anon key and no session, which is what a stranger on the internet is.
    const anon = anonClient();
    const { error } = await kitchen(anon).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });
    expect(error).not.toBeNull();
  });

  it("a day far in the past records nothing and does not raise", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Backdated Attendance Group");

    const { error } = await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: "2020-01-01",
      p_surface: "dishes",
    });
    expect(error).toBeNull();
    expect(await countFor(orgId, owner.id)).toBe(0);
  });

  it("an unknown surface records nothing", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Unknown Surface Group");

    const { error } = await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "payroll",
    });
    expect(error).toBeNull();
    expect(await countFor(orgId, owner.id)).toBe(0);
  });

  it("nobody can select from the table, not even their own rows", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Sealed Attendance Group");
    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });

    // The owner's own client, not admin: the service role bypasses RLS and would prove nothing.
    const { data, error } = await kitchen(owner.client)
      .from("activity_days")
      .select("org_id")
      .eq("org_id", orgId);
    // RLS with no select policy is the strictest setting, not a gap: the table is write-only
    // for every role, so even the person the row is about cannot read it back.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("the same person in two groups records a row per group", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const firstOrg = await newOrg(owner.client, "First Attendance Group");
    const secondOrg = await newOrg(owner.client, "Second Attendance Group");

    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: firstOrg,
      p_day: today,
      p_surface: "dishes",
    });
    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: secondOrg,
      p_day: today,
      p_surface: "dishes",
    });
    // This is why org_id is in the primary key: an owner must never see attendance from
    // another employer, so the same person's day is one row per group and never one row total.
    expect(await countFor(firstOrg, owner.id)).toBe(1);
    expect(await countFor(secondOrg, owner.id)).toBe(1);
  });

  it("erasing the group takes its attendance with it", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Erased Attendance Group");
    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });

    await kitchen(owner.client).rpc("erase_org", { p_org: orgId });
    expect(await countForOrg(orgId)).toBe(0);
  });

  it("deleting the account takes its attendance with it", async () => {
    const owner = await makeUser(`kit-att-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Deleted Account Group");
    await kitchen(owner.client).rpc("record_kitchen_visit", {
      p_org: orgId,
      p_day: today,
      p_surface: "dishes",
    });

    const { error } = await admin.auth.admin.deleteUser(owner.id);
    // Without an `on delete` action this column would instead VETO account deletion, which
    // eight columns in this schema once did.
    expect(error).toBeNull();
    expect(await countFor(orgId, owner.id)).toBe(0);
  });
});
