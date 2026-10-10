import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigate,
}));
vi.mock("../lib/api/auth", () => ({
  signIn: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import SignIn from "./SignIn";

// This page is the first thing a stranger sees: every guarded route sends a signed-out
// visitor here, and before the landing page existed it was a dead end for them, because the
// only thing on it that said what the product is was a "Need an account?" link.
test("points a stranger at the page that explains what this is", () => {
  render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: /what is this/i });
  // An absolute href, not a <Link>: the explanation lives on the OTHER host, and a router
  // link would try to resolve it as a route inside the app and 404 into the SPA fallback.
  expect(link).toHaveAttribute("href", "https://enamelvault.com/");
});

// The mark at the top of the card is the other half of the same thing, and the one a visitor
// recognises as a way out: this page is outside AppLayout, so nothing else on it links away.
test("the mark goes back to the landing page", () => {
  render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /family recipes/i })).toHaveAttribute(
    "href",
    "https://enamelvault.com/",
  );
});

// The one door that always worked, pinned so it stays working now the mechanism changed from
// router state to the URL.
test("signing in lands on the invite it was sent from", async () => {
  const { signIn } = await import("../lib/api/auth");
  (signIn as any).mockResolvedValue({ id: "u1" });
  render(
    <MemoryRouter initialEntries={["/signin?next=%2Fjoin%2Fabc123"]}>
      <SignIn />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.dev" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/join/abc123"));
});
