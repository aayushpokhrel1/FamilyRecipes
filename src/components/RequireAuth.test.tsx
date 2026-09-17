import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
