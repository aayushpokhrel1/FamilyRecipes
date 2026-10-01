import { render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { FamilyProvider, useFamily } from "./FamilyContext";

vi.mock("../lib/api/families", () => ({
  listMyFamilies: vi.fn().mockResolvedValue([
    { id: "f1", name: "Alpha", invite_code: "a", created_by: "u", role: "owner" },
    { id: "f2", name: "Beta", invite_code: "b", created_by: "u", role: "member" },
  ]),
  ensureOwnKitchen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/api/errorLog", () => ({ reportError: vi.fn() }));

import { ensureOwnKitchen, listMyFamilies } from "../lib/api/families";
import { reportError } from "../lib/api/errorLog";

// Call history is cleared between tests, but the implementations set in the factory above are
// kept, so each test starts from the same non-empty default list.
beforeEach(() => {
  vi.mocked(listMyFamilies).mockClear();
  vi.mocked(ensureOwnKitchen).mockClear();
  vi.mocked(reportError).mockClear();
});

function Consumer() {
  const { activeFamily } = useFamily();
  return <div>{activeFamily?.name ?? "no family"}</div>;
}

test("defaults to the first family after load", async () => {
  render(
    <FamilyProvider>
      <Consumer />
    </FamilyProvider>,
  );
  expect(await screen.findByText("Alpha")).toBeInTheDocument();
});

// A brand-new account has a profile and no family, and recipes.family_id is not null, so
// without this the cook can fill in the whole form and Save does nothing. The provider is
// the one place that can fix it before any page asks.
test("an empty list creates a kitchen and the second listing becomes active", async () => {
  vi.mocked(listMyFamilies)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { id: "f9", name: "My Kitchen", invite_code: "k", created_by: "u", role: "owner" },
    ]);

  render(
    <FamilyProvider>
      <Consumer />
    </FamilyProvider>,
  );

  expect(await screen.findByText("My Kitchen")).toBeInTheDocument();
  expect(ensureOwnKitchen).toHaveBeenCalledTimes(1);
  expect(listMyFamilies).toHaveBeenCalledTimes(2);
});

// The extra round trip rule: a cook who already has a kitchen must not pay for the RPC on
// every page load.
test("a non-empty list does not call ensureOwnKitchen", async () => {
  vi.mocked(listMyFamilies).mockResolvedValueOnce([
    { id: "f1", name: "Alpha", invite_code: "a", created_by: "u", role: "owner" },
  ]);

  render(
    <FamilyProvider>
      <Consumer />
    </FamilyProvider>,
  );

  expect(await screen.findByText("Alpha")).toBeInTheDocument();
  expect(ensureOwnKitchen).not.toHaveBeenCalled();
  expect(listMyFamilies).toHaveBeenCalledTimes(1);
});

// An exception thrown out of the provider takes the whole app down, and the pages already
// handle "no family" by showing a message, so a failure here must fall through quietly.
test("a failing ensureOwnKitchen still renders children with no active family", async () => {
  vi.mocked(listMyFamilies).mockResolvedValueOnce([]);
  vi.mocked(ensureOwnKitchen).mockRejectedValueOnce(new Error("rpc is on fire"));

  render(
    <FamilyProvider>
      <Consumer />
    </FamilyProvider>,
  );

  expect(await screen.findByText("no family")).toBeInTheDocument();
  expect(reportError).toHaveBeenCalledWith("load:family-context", expect.any(Error));
  expect(ensureOwnKitchen).toHaveBeenCalledTimes(1);
});
