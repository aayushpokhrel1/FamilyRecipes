import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PipelineActions from "./PipelineActions";
import { sendToTrial, signOff, recordDeviation } from "../../lib/api/kitchen/dishes";
import type { Dish, Site } from "../../lib/api/kitchen/types";

vi.mock("../../lib/api/kitchen/dishes", () => ({
  sendToTrial: vi.fn(), signOff: vi.fn(), recordDeviation: vi.fn(),
}));

const sites: Site[] = [
  { id: "s1", org_id: "o1", name: "Shoreditch", closed_at: null },
  { id: "s2", org_id: "o1", name: "Peckham", closed_at: null },
];
const inDevelopment: Dish = {
  id: "d1", org_id: "o1", title: "Tart", stage: "development", trial_site_id: null, retired_at: null,
};
const onTrial: Dish = { ...inDevelopment, stage: "trial", trial_site_id: "s1" };
const onMenu: Dish = { ...inDevelopment, stage: "menu", trial_site_id: null };

beforeEach(() => vi.clearAllMocks());

describe("sending a dish to trial", () => {
  it("lets a chef pick one site", async () => {
    render(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={sites} role="chef" onDone={vi.fn()} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/trial at/i), "s2");
    await userEvent.click(screen.getByRole("button", { name: /send to trial/i }));
    expect(sendToTrial).toHaveBeenCalledWith("d1", "s2");
  });

  // THE CASE THE TEST ABOVE CANNOT SEE, and the one that shipped broken. That test renders
  // with `sites` already full AND changes the dropdown, which is the single path that worked.
  // In the real app DishDetail starts `sites` as [] and fills it from a fetch, and an owner
  // who accepts the site already shown never fires onChange.
  it("sends to the site shown when sites arrive after the first render", async () => {
    const { rerender } = render(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={[]} role="chef" onDone={vi.fn()} />,
    );
    rerender(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={sites} role="chef" onDone={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: /send to trial/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(sendToTrial).toHaveBeenCalledWith("d1", "s1");
  });

  // The worst version of it: with ONE site there is nothing else to pick, so a dropdown that
  // ignores what it displays leaves the dish stuck in development forever.
  it("works for a group with a single site, which cannot change the dropdown", async () => {
    const { rerender } = render(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={[]} role="owner" onDone={vi.fn()} />,
    );
    rerender(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={[sites[0]]} role="owner" onDone={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /send to trial/i }));
    expect(sendToTrial).toHaveBeenCalledWith("d1", "s1");
  });

  it("is not offered for a dish already on the menu", () => {
    render(
      <PipelineActions dish={onMenu} newestVersionId="v1" sites={sites} role="chef" onDone={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /send to trial/i })).not.toBeInTheDocument();
  });

  it("is not offered to a cook", () => {
    render(
      <PipelineActions dish={inDevelopment} newestVersionId="v1" sites={sites} role="cook" onDone={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /send to trial/i })).not.toBeInTheDocument();
  });
});

describe("signing off", () => {
  it("signs off the newest version and refreshes", async () => {
    const onDone = vi.fn();
    render(
      <PipelineActions dish={onTrial} newestVersionId="v2" sites={sites} role="chef" onDone={onDone} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign off/i }));
    expect(signOff).toHaveBeenCalledWith("v2");
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the database's wrong-stage refusal instead of appearing to work", async () => {
    // Sign-off straight from development is refused with KIT02. The button is offered on a
    // menu dish too (to approve a newer version), so this path is reachable in normal use.
    vi.mocked(signOff).mockRejectedValue(new Error("trial that dish at a site first"));
    render(
      <PipelineActions dish={onMenu} newestVersionId="v2" sites={sites} role="chef" onDone={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign off/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("trial that dish at a site first");
  });
});

describe("deviations", () => {
  it("lets a site manager record one, for their own site", async () => {
    render(
      <PipelineActions
        dish={onMenu} newestVersionId="v1" sites={sites} role="site_manager"
        mySiteId="s1" onDone={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/what you had to change/i), "Cheddar, no comte");
    await userEvent.click(screen.getByRole("button", { name: /record it/i }));
    expect(recordDeviation).toHaveBeenCalledWith("d1", "s1", "Cheddar, no comte");
  });

  it("shows the refusal when the database says that is not their site", async () => {
    vi.mocked(recordDeviation).mockRejectedValue(
      new Error("you cannot record a deviation for that site"),
    );
    render(
      <PipelineActions
        dish={onMenu} newestVersionId="v1" sites={sites} role="site_manager"
        mySiteId="s1" onDone={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/what you had to change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /record it/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot record a deviation");
  });

  it("offers a cook nothing at all", () => {
    render(
      <PipelineActions dish={onMenu} newestVersionId="v1" sites={sites} role="cook" onDone={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/what you had to change/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign off/i })).not.toBeInTheDocument();
  });
});
