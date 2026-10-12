import { Outlet } from "react-router-dom";
import KitchenTermsGate from "./KitchenTermsGate";

// One wrapper for every route that DOES something, rather than the gate repeated per route.
//
// Repeating it would be six chances to forget the seventh, and forgetting one is exactly the
// mistake this product already made: plans 1 to 3 shipped with no gate on any route at all.
// With the gate as a layout, routes.terms.test.tsx can ask the structural question instead of
// a per-line one: is this path inside the gated band, or is it on the short list of paths a
// visitor may reach without accepting anything.
export default function GatedLayout() {
  return (
    <KitchenTermsGate>
      <Outlet />
    </KitchenTermsGate>
  );
}
