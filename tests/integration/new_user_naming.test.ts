// @vitest-environment node
// What a cook is CALLED the moment their account exists. This is a trigger on auth.users, so
// it is tested by creating real users with real provider metadata.
//
// The bug this exists to stop: handle_new_user read only `display_name`, which is set by the
// app's own email signup and by nothing else, so every cook arriving through Google was called
// the literal "Cook" and showed up that way to their family and in the moderator roster. It
// shipped and sat there unnoticed, because no test ever created a user the way a provider
// does.
//
// ADDING A SIGN-IN METHOD? Add a case here with the metadata THAT provider really sends. A
// provider using a key the trigger does not read falls back to "Cook" silently: nothing
// errors, nothing warns.
import { describe, it, expect } from "vitest";
import { admin } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// Creates the auth user with the metadata a given provider would carry, then reads back the
// profile the trigger wrote. The user is created confirmed, exactly as the OAuth path does.
async function nameFor(meta: Record<string, string>): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `naming-${rand()}@t.dev`,
    password: "password123",
    email_confirm: true,
    user_metadata: meta,
  });
  if (error) throw error;
  const { data: profile } = await admin
    .from("profiles").select("display_name").eq("id", data.user!.id).single();
  return (profile as { display_name: string }).display_name;
}

describe("a new cook is called by their name, whichever way they signed in", () => {
  it("uses display_name from this app's own signup form", async () => {
    expect(await nameFor({ display_name: "Aayush Pokhrel" })).toBe("Aayush Pokhrel");
  }, 30000);

  // The actual shape Google sends. `full_name` and `name` both arrive, neither is
  // `display_name`, and reading only the latter is what produced "Cook".
  it("uses the name Google sends, not the literal Cook", async () => {
    const got = await nameFor({
      full_name: "Mei Tanaka",
      name: "Mei Tanaka",
      email: "mei@gmail.test",
      picture: "https://lh3.googleusercontent.test/a/mei",
      email_verified: "true",
    });
    expect(got).toBe("Mei Tanaka");
    expect(got).not.toBe("Cook");
  }, 30000);

  it("falls back to name when full_name is absent", async () => {
    expect(await nameFor({ name: "Bo Lin" })).toBe("Bo Lin");
  }, 30000);

  // The app's own key wins: it is the only one the person typed into THIS app.
  it("prefers the typed display_name over a provider's name", async () => {
    expect(await nameFor({ display_name: "Nana", full_name: "Eleanor Rose" })).toBe("Nana");
  }, 30000);

  // A provider that sends a blank or whitespace name must not produce a blank cook: the
  // column is not null and a nameless row reads worse than the fallback.
  it("falls back to Cook when nothing usable is sent", async () => {
    expect(await nameFor({ full_name: "   ", name: "" })).toBe("Cook");
    expect(await nameFor({})).toBe("Cook");
  }, 30000);

  // profiles.avatar_url is a PATH inside the avatars storage bucket, which createSignedUrl
  // consumes. Google's `picture` is an absolute URL, and storing one here would type-check,
  // pass every unit test, and then fail at signing time for that cook alone.
  it("never copies the provider's picture into avatar_url", async () => {
    const { data } = await admin.auth.admin.createUser({
      email: `naming-av-${rand()}@t.dev`,
      password: "password123",
      email_confirm: true,
      user_metadata: {
        full_name: "Ada Pic",
        picture: "https://lh3.googleusercontent.test/a/ada",
        avatar_url: "https://lh3.googleusercontent.test/a/ada",
      },
    });
    const { data: profile } = await admin
      .from("profiles").select("avatar_url").eq("id", data.user!.id).single();
    expect((profile as { avatar_url: string | null }).avatar_url).toBeNull();
  }, 30000);
});
