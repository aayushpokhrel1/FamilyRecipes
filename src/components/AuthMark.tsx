// The mark at the top of an auth card. The auth pages are the only ones outside AppLayout,
// so without this they carry no branding and nothing that leads off them: every guarded
// route sends a signed-out visitor to one of them, often from a shared recipe link, knowing
// nothing about the product.
//
// A plain <a>, NOT a <Link>: the landing page lives on the OTHER host, so a router link
// would resolve it as a route inside this app and fall through to the SPA.
// alt="" on purpose: the wordmark beside it already names the link, and a second
// announcement is noise to a screen reader.
export default function AuthMark() {
  return (
    <a className="auth-mark" href="https://enamelvault.com/">
      <img src="/favicon.svg" alt="" width="34" height="34" />
      Family Recipes
    </a>
  );
}
