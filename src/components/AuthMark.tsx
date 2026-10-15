// The mark at the top of an auth card. The auth pages are the only ones outside AppLayout,
// so without this they carry no branding and nothing that leads off them: every guarded
// route sends a signed-out visitor to one of them, often from a shared recipe link, knowing
// nothing about the product.
//
// A plain <a>, NOT a <Link>: the landing page lives on the OTHER host, so a router link
// would resolve it as a route inside this app and fall through to the SPA.
// alt="" on purpose: the wordmark beside it already names the link, and a second
// announcement is noise to a screen reader.
// `label` is REQUIRED, with no default, and that is the whole point of the prop. This
// component is shared by BOTH apps, and it used to hard-code "Family Recipes": the moment the
// kitchen app's sign-in reused it, a chef signing in to the professional product was greeted
// by the family product's name. A default would have left exactly that trap armed for the
// next kitchen auth page somebody adds. Required means the compiler asks the question.
//
// The href stays the shared landing page for both, which is correct now that it offers a
// choice of the two apps rather than sending everyone to the family one.
export default function AuthMark({ label }: { label: string }) {
  return (
    <a className="auth-mark" href="https://enamelvault.com/">
      <img src="/favicon.svg" alt="" width="34" height="34" />
      {label}
    </a>
  );
}
