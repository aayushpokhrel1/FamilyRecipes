import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublishPanel from "./PublishPanel";
import { publishDish, unpublishDish } from "../../lib/api/kitchen/dishes";
import type { Dish } from "../../lib/api/kitchen/types";

vi.mock("../../lib/api/kitchen/dishes", () => ({ publishDish: vi.fn(), unpublishDish: vi.fn() }));

const onMenu: Dish = {
  id: "d1", org_id: "o1", title: "Tart", stage: "menu", trial_site_id: null,
};

beforeEach(() => vi.clearAllMocks());

describe("publishing", () => {
  it("is offered to an owner for a dish on the menu", () => {
    render(<PublishPanel dish={onMenu} menuVersionId="v1" snapshot={null} role="owner" onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("is NOT offered to a chef, because publishing speaks for the business", () => {
    render(<PublishPanel dish={onMenu} menuVersionId="v1" snapshot={null} role="chef" onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("is not offered for a dish nobody has signed off", () => {
    render(<PublishPanel dish={onMenu} menuVersionId={null} snapshot={null} role="owner" onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("publishes the version the sites are cooking, not the newest one", async () => {
    render(<PublishPanel dish={onMenu} menuVersionId="v1" snapshot={null} role="owner" onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(publishDish).toHaveBeenCalledWith("v1");
  });

  it("shows the public link once it is published", () => {
    render(
      <PublishPanel
        dish={onMenu} menuVersionId="v1" role="owner" onDone={vi.fn()}
        snapshot={{ recipe_id: "r1", version_id: "v1", published_at: "2026-10-11T10:00:00Z", unpublished_at: null }}
      />,
    );
    expect(screen.getByText(/recipes.enamelvault.com\/recipes\/r1/)).toBeInTheDocument();
  });

  it("surfaces a takedown refusal rather than looking like it worked", async () => {
    // enforce_publish_rules blocks a republish of a removed snapshot. The owner needs to read
    // that sentence, because nothing they can do in this app will fix it.
    vi.mocked(publishDish).mockRejectedValue(
      new Error("this recipe was removed from Potluck and cannot be published again"),
    );
    render(<PublishPanel dish={onMenu} menuVersionId="v1" snapshot={null} role="owner" onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("removed from Potluck");
  });

  it("unpublishes", async () => {
    render(
      <PublishPanel
        dish={onMenu} menuVersionId="v1" role="owner" onDone={vi.fn()}
        snapshot={{ recipe_id: "r1", version_id: "v1", published_at: "2026-10-11T10:00:00Z", unpublished_at: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /take it down/i }));
    expect(unpublishDish).toHaveBeenCalledWith("d1");
  });
});

describe("after a takedown", () => {
  // Found in a browser on 2026-10-11: taking a dish down left the page saying "Published at
  // https://..." with a "Take it down" button, because the snapshot row survives a takedown
  // and nothing recorded which state it was in. An owner could not tell whether their dish
  // was public, which is the only question this panel answers.
  const takenDown = {
    recipe_id: "r1",
    version_id: "v1",
    published_at: "2026-10-11T10:00:00Z",
    unpublished_at: "2026-10-11T11:00:00Z",
  };

  it("stops claiming the dish is published", () => {
    render(
      <PublishPanel dish={onMenu} menuVersionId="v1" snapshot={takenDown} role="owner" onDone={vi.fn()} />,
    );
    expect(screen.queryByText(/Published at/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take it down/i })).not.toBeInTheDocument();
  });

  it("offers to publish it again", async () => {
    render(
      <PublishPanel dish={onMenu} menuVersionId="v1" snapshot={takenDown} role="owner" onDone={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(publishDish).toHaveBeenCalledWith("v1");
  });
});
