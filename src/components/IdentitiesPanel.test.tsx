import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";

const listIdentities = vi.fn();
const linkGoogle = vi.fn().mockResolvedValue(undefined);
const unlinkIdentity = vi.fn().mockResolvedValue(undefined);
const setFirstPassword = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/api/identities", async () => {
  const actual = await vi.importActual<typeof import("../lib/api/identities")>(
    "../lib/api/identities"
  );
  return {
    hasProvider: actual.hasProvider,
    listIdentities: () => listIdentities(),
    linkGoogle: () => linkGoogle(),
    unlinkIdentity: (i: unknown) => unlinkIdentity(i),
  };
});
vi.mock("../lib/api/auth", () => ({ setFirstPassword: (p: string) => setFirstPassword(p) }));

import IdentitiesPanel from "./IdentitiesPanel";

const email = { identity_id: "i1", provider: "email" };
const google = { identity_id: "i2", provider: "google" };

beforeEach(() => {
  vi.clearAllMocks();
});

test("offers Connect when only an email identity exists", async () => {
  listIdentities.mockResolvedValue([email]);
  render(<IdentitiesPanel />);
  await screen.findByRole("button", { name: /connect google/i });
  expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
});

test("offers Disconnect when Google is linked alongside email", async () => {
  listIdentities.mockResolvedValue([email, google]);
  render(<IdentitiesPanel />);
  const button = await screen.findByRole("button", { name: /disconnect google/i });
  expect(button).not.toHaveProperty("disabled", true);
  fireEvent.click(button);
  await waitFor(() => expect(unlinkIdentity).toHaveBeenCalledWith(google));
});

// The lockout case. Supabase would refuse this anyway; the point is that the person
// is told why BEFORE pressing, not handed a raw error on a security screen.
test("refuses to disconnect the only identity, and explains", async () => {
  listIdentities.mockResolvedValue([google]);
  render(<IdentitiesPanel />);
  const button = await screen.findByRole("button", { name: /disconnect google/i });
  expect(button).toHaveProperty("disabled", true);
  expect(screen.getByText(/only way into your account/i)).toBeTruthy();
  fireEvent.click(button);
  expect(unlinkIdentity).not.toHaveBeenCalled();
});

test("offers to set a first password only when there is no email identity", async () => {
  listIdentities.mockResolvedValue([google]);
  const { unmount } = render(<IdentitiesPanel />);
  await screen.findByLabelText("New password");

  unmount();
  listIdentities.mockResolvedValue([email, google]);
  render(<IdentitiesPanel />);
  await screen.findByRole("button", { name: /disconnect google/i });
  expect(screen.queryByLabelText("New password")).toBeNull();
});

test("will not set a first password when the two do not match", async () => {
  listIdentities.mockResolvedValue([google]);
  render(<IdentitiesPanel />);
  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "aaaaaaaa" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "bbbbbbbb" } });
  fireEvent.click(screen.getByRole("button", { name: /set password/i }));
  await screen.findByText(/do not match/i);
  expect(setFirstPassword).not.toHaveBeenCalled();
});

test("sets a first password when they match", async () => {
  listIdentities.mockResolvedValue([google]);
  render(<IdentitiesPanel />);
  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "aaaaaaaa" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "aaaaaaaa" } });
  fireEvent.click(screen.getByRole("button", { name: /set password/i }));
  await waitFor(() => expect(setFirstPassword).toHaveBeenCalledWith("aaaaaaaa"));
});
