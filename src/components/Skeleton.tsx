// The app's one loading state. It replaced twelve copies of <p>Loading...</p>, and the
// point of the shapes is honesty: a skeleton claims to know what is coming, so only use
// a shape that matches. When the shape is genuinely unknown, a sentence is the correct
// answer and this component is the wrong one.
//
// "grid" renders into .plate-grid, so the settle animation on .plate-grid > * carries the
// skeleton tiles as well as the real cards. Do NOT wrap "lines" in a .plate: it is meant
// for use INSIDE one, and a plate inside a plate is a nested card.
export default function Skeleton({
  shape,
  count = 3,
}: {
  shape: "grid" | "plate" | "lines";
  count?: number;
}) {
  // A live region, NOT role="status". It still announces, so nobody loses the "Loading"
  // the sentence used to say, but it does not claim the status role: the app uses that
  // role for its own save confirmations, and a skeleton holding it made
  // getByRole("status") ambiguous and broke the Settings save test.
  const bars = Array.from({ length: count }, (_, i) => (
    <div key={i} className="skeleton-bar" />
  ));

  if (shape === "grid") {
    return (
      <ul className="plate-grid" aria-busy="true" aria-live="polite" aria-label="Loading">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="skeleton-tile" />
        ))}
      </ul>
    );
  }

  if (shape === "plate") {
    return (
      <section className="plate skeleton" aria-busy="true" aria-live="polite" aria-label="Loading">
        {bars}
      </section>
    );
  }

  return (
    <div className="skeleton" aria-busy="true" aria-live="polite" aria-label="Loading">
      {bars}
    </div>
  );
}
