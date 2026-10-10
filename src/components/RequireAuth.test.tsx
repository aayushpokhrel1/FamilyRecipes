import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { vi } from "vitest";
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ userId: null, loading: false }) }));
test("redirects to signin when logged out", () => {
  render(<MemoryRouter initialEntries={["/app"]}>
    <Routes>
      <Route path="/signin" element={<div>signin page</div>} />
      <Route path="/app" element={<RequireAuth><div>secret</div></RequireAuth>} />
    </Routes>
  </MemoryRouter>);
  expect(screen.getByText("signin page")).toBeInTheDocument();
});

// The guard is the OTHER producer of a destination, alongside the invite page: any guarded
// link sent to a signed-out person comes through here. In the URL, not in router state, for
// the same reason as everywhere else: state does not survive Google or an email link.
test("carries the guarded destination, query and all, in the URL", () => {
  render(<MemoryRouter initialEntries={["/kitchen/cupboard?tab=spices"]}>
    <Routes>
      <Route path="/signin" element={<Destination />} />
      <Route path="/kitchen/cupboard" element={<RequireAuth><div>secret</div></RequireAuth>} />
    </Routes>
  </MemoryRouter>);
  expect(screen.getByTestId("where")).toHaveTextContent(
    "?next=%2Fkitchen%2Fcupboard%3Ftab%3Dspices",
  );
});

function Destination() {
  const { search } = useLocation();
  return <div data-testid="where">{search}</div>;
}
