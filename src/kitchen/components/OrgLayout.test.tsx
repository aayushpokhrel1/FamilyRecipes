import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OrgLayout from "./OrgLayout";
import { recordKitchenVisit } from "../../lib/api/kitchen/visit";

const orgs = vi.hoisted(() => ({
  value: [{ id: "o1", name: "Cold Harbour Kitchen" }] as { id: string; name: string }[],
  fail: false,
}));

vi.mock("../../lib/api/kitchen/orgs", () => ({
  myOrgs: vi.fn(() => (orgs.fail ? Promise.reject(new Error("offline")) : Promise.resolve(orgs.value))),
}));

vi.mock("../../lib/api/kitchen/visit", () => ({ recordKitchenVisit: vi.fn() }));

beforeEach(() => {
  orgs.value = [{ id: "o1", name: "Cold Harbour Kitchen" }];
  orgs.fail = false;
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/orgs/:id" element={<OrgLayout />}>
          <Route path="dishes" element={<p>the dishes page</p>} />
          <Route path="staff" element={<p>the staff page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("OrgLayout", () => {
  it("reaches all three sections from any one of them", async () => {
    renderAt("/orgs/o1/dishes");
    expect(await screen.findByRole("link", { name: "Sites" })).toHaveAttribute(
      "href",
      "/orgs/o1/sites",
    );
    expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("href", "/orgs/o1/staff");
    expect(screen.getByRole("link", { name: "Dishes" })).toHaveAttribute("href", "/orgs/o1/dishes");
  });

  it("marks the section you are on", async () => {
    renderAt("/orgs/o1/staff");
    expect(await screen.findByRole("link", { name: "Staff" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dishes" })).not.toHaveAttribute("aria-current");
  });

  it("names the group and links back to the group list", async () => {
    renderAt("/orgs/o1/dishes");
    const back = await screen.findByRole("link", { name: "Cold Harbour Kitchen" });
    expect(back).toHaveAttribute("href", "/");
  });

  // The links are the function and the name is decoration, so losing the network must not
  // cost the navigation.
  it("still navigates when the group name cannot be loaded", async () => {
    orgs.fail = true;
    renderAt("/orgs/o1/dishes");
    expect(await screen.findByRole("link", { name: "Sites" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your kitchens" })).toHaveAttribute("href", "/");
  });

  it("falls back the same way for an id that is not one of yours", async () => {
    renderAt("/orgs/not-mine/dishes");
    expect(await screen.findByRole("link", { name: "Your kitchens" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sites" })).toHaveAttribute(
      "href",
      "/orgs/not-mine/sites",
    );
  });

  it("renders the page inside it", async () => {
    renderAt("/orgs/o1/dishes");
    expect(await screen.findByText("the dishes page")).toBeInTheDocument();
  });

  it("records a visit for the group being viewed", async () => {
    renderAt("/orgs/o1/dishes");
    await screen.findByText("the dishes page");
    expect(recordKitchenVisit).toHaveBeenCalledWith("o1", "/orgs/o1/dishes");
  });
});
