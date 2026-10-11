import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import NewOrg from "./NewOrg";
import { createOrg } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/orgs", () => ({ createOrg: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("starting a kitchen group", () => {
  it("refuses an empty name with its reason, and calls nothing", async () => {
    render(
      <MemoryRouter>
        <NewOrg />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/name/i);
    expect(createOrg).not.toHaveBeenCalled();
  });

  it("creates the org with the two names it asked for", async () => {
    vi.mocked(createOrg).mockResolvedValue("org-1");
    render(
      <MemoryRouter>
        <NewOrg />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/group name/i), "Enamel Group");
    await userEvent.type(screen.getByLabelText(/your name/i), "Sam");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(createOrg).toHaveBeenCalledWith("Enamel Group", "Sam");
  });

  it("shows the database's refusal rather than swallowing it", async () => {
    vi.mocked(createOrg).mockRejectedValue(new Error("sign in first"));
    render(
      <MemoryRouter>
        <NewOrg />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/group name/i), "Enamel Group");
    await userEvent.type(screen.getByLabelText(/your name/i), "Sam");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sign in first");
  });
});
