import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import KitchenTermsGate, { KITCHEN_TERMS_VERSION } from "./KitchenTermsGate";

// The gate is the only thing between a brand-new kitchen account and creating an org, which is
// an action. Before it existed, every route in this app was reachable without accepting
// anything, and the suite was green because no test read this app's routes file.
const getMyAcceptance = vi.fn();
const acceptKitchenTerms = vi.fn();
vi.mock("../../lib/api/kitchen/terms", () => ({
  getMyAcceptance: () => getMyAcceptance(),
  acceptKitchenTerms: (version: string) => acceptKitchenTerms(version),
}));

const renderGate = () =>
  render(
    <MemoryRouter>
      <KitchenTermsGate>
        <p>The dashboard</p>
      </KitchenTermsGate>
    </MemoryRouter>,
  );

beforeEach(() => {
  getMyAcceptance.mockReset();
  acceptKitchenTerms.mockReset();
  acceptKitchenTerms.mockResolvedValue(undefined);
});

it("shows the app when the current version is already accepted", async () => {
  getMyAcceptance.mockResolvedValue({
    version: KITCHEN_TERMS_VERSION,
    accepted_at: "2026-10-11T00:00:00Z",
  });
  renderGate();
  expect(await screen.findByText("The dashboard")).toBeInTheDocument();
});

it("asks a first-time user to accept, and does not render the app behind it", async () => {
  getMyAcceptance.mockResolvedValue(null);
  renderGate();
  expect(await screen.findByRole("button", { name: /accept and continue/i })).toBeInTheDocument();
  // Behind it, not merely over it: a page rendered underneath is a page somebody can reach.
  expect(screen.queryByText("The dashboard")).not.toBeInTheDocument();
});

it("tells a returning user the terms CHANGED rather than asking as if they were new", async () => {
  // Someone who accepted in good faith should not be told to read them "before you put your
  // kitchen's dishes in here", because they already did that.
  getMyAcceptance.mockResolvedValue({ version: "2026-10-01", accepted_at: "2026-10-01T00:00:00Z" });
  renderGate();
  expect(await screen.findByText(/have been updated/i)).toBeInTheDocument();
});

it("lets somebody in when the acceptance read FAILS, rather than locking them out", async () => {
  // Not a convenience. Until the hosted project exposes the `kitchen` schema BY HAND, every
  // kitchen call on that host errors, so a gate that refused on error would lock out a whole
  // group over one unset setting, with no way for them to tell why.
  getMyAcceptance.mockRejectedValue(new Error("The schema must be one of the following: kitchen"));
  renderGate();
  expect(await screen.findByText("The dashboard")).toBeInTheDocument();
});

it("records the version it actually showed, not merely some version", async () => {
  // A mismatch here makes the stored row evidence of text the person never saw, and that row
  // is the only evidence that consent was given at all.
  getMyAcceptance.mockResolvedValue(null);
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: /accept and continue/i }));
  await waitFor(() => expect(acceptKitchenTerms).toHaveBeenCalledWith(KITCHEN_TERMS_VERSION));
  expect(await screen.findByText("The dashboard")).toBeInTheDocument();
});

it("links both documents, since the prompt is the only place most people meet them", async () => {
  getMyAcceptance.mockResolvedValue(null);
  renderGate();
  expect(await screen.findByRole("link", { name: /read the terms/i })).toHaveAttribute(
    "href",
    "/terms",
  );
  expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
});
