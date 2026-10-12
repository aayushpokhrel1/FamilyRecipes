import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { CONTACT_EMAIL } from "../../lib/legal";
import KitchenFooter from "./KitchenFooter";

// The documents are worthless if nothing links to them, and for most of this app's life
// nothing did: the kitchen had no footer at all. These are the two claims the footer makes
// that have to stay true.
const renderFooter = () =>
  render(
    <MemoryRouter>
      <KitchenFooter />
    </MemoryRouter>,
  );

it("links both documents", () => {
  renderFooter();
  expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
});

it("publishes the contact address legal.ts holds, not one of its own", () => {
  // lib/api/legal.ts is the single home for that fact because pages disagreeing about the
  // contact address is the failure mode it was written to stop, and a legal page naming a dead
  // mailbox is worse than one naming none: under UK and EU law a policy has to give a working
  // contact route.
  renderFooter();
  expect(screen.getByRole("link", { name: /contact/i })).toHaveAttribute(
    "href",
    `mailto:${CONTACT_EMAIL}`,
  );
});
