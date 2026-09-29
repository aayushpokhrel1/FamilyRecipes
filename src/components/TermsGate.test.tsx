import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TermsGate, { TERMS_VERSION } from "./TermsGate";
import { acceptTerms, getMyProfile } from "../lib/api/profile";
import type { Profile } from "../lib/api/types";

vi.mock("../lib/api/profile", () => ({
  getMyProfile: vi.fn(),
  acceptTerms: vi.fn(),
}));

const mockedGetMyProfile = vi.mocked(getMyProfile);
const mockedAcceptTerms = vi.mocked(acceptTerms);

function profile(over: Partial<Profile>): Profile {
  return {
    id: "u1",
    display_name: "Aayush",
    avatar_url: null,
    preferences: {},
    handle: null,
    public_name: null,
    bio: null,
    is_moderator: false,
    terms_accepted_at: null,
    terms_version: null,
    ...over,
  };
}

function renderGate() {
  return render(
    <MemoryRouter>
      <TermsGate>
        <div>the app</div>
      </TermsGate>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TermsGate", () => {
  it("shows the accept screen when terms were never accepted", async () => {
    mockedGetMyProfile.mockResolvedValue(profile({ terms_accepted_at: null }));
    renderGate();
    expect(await screen.findByText("Before you continue")).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
  });

  it("shows the accept screen when the accepted version is behind", async () => {
    mockedGetMyProfile.mockResolvedValue(
      profile({ terms_accepted_at: "2026-01-01T00:00:00.000Z", terms_version: "2026-01-01" }),
    );
    renderGate();
    expect(await screen.findByText("Before you continue")).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
  });

  it("shows the children when the current version is accepted", async () => {
    mockedGetMyProfile.mockResolvedValue(
      profile({ terms_accepted_at: "2026-09-28T00:00:00.000Z", terms_version: TERMS_VERSION }),
    );
    renderGate();
    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(screen.queryByText("Before you continue")).not.toBeInTheDocument();
  });

  it("accepts the current version and then shows the children", async () => {
    mockedGetMyProfile.mockResolvedValue(profile({ terms_accepted_at: null }));
    mockedAcceptTerms.mockResolvedValue(undefined);
    renderGate();
    await userEvent.click(await screen.findByRole("button", { name: "Accept and continue" }));
    await waitFor(() => expect(mockedAcceptTerms).toHaveBeenCalledWith(TERMS_VERSION));
    expect(await screen.findByText("the app")).toBeInTheDocument();
  });
});
