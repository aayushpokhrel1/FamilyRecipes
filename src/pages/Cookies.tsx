import { Link } from "react-router-dom";
import { CONTACT_EMAIL, COOKIES_UPDATED } from "../lib/legal";

// There is no cookie banner in this app, and that is a deliberate consequence of this page
// being TRUE: everything the app stores, the one cookie included, is STRICTLY NECESSARY, which
// UK/EU law exempts from consent. The banner is not skipped, it is unnecessary.
//
// UPDATED 2026-10-26, when the session moved out of localStorage into a cookie on
// `.enamelvault.com` so that one sign-in covers all three apps. A cookie whose only job is to
// keep you signed in to the thing you just signed in to is strictly necessary, so the exemption
// still applies and no banner appeared. What changed is that "this app sets no cookies", which
// this comment and seven public statements used to say, is now false and has been corrected
// everywhere. src/lib/sessionCookie.ts holds the security trade that cookie makes.
//
// THE DAY THAT STOPS BEING TRUE, A BANNER BECOMES MANDATORY. It stops being true the moment
// anyone adds analytics, an ad script, an embedded video, a social widget, a SECOND cookie, or
// any storage that is not required for a feature the user asked for. The keys and the one
// cookie listed below are the whole set; src/lib/browserStorage.test.ts allows exactly one
// named file to write a cookie and fails when anything else appears.
export default function Cookies() {
  return (
    <div className="prose plate">
      <h1>Cookies and local storage</h1>
      <p className="updated">Last updated {COOKIES_UPDATED}</p>

      <h2>This site sets one cookie, and it is the one that signs you in</h2>
      <p>
        There are no advertising cookies, no analytics cookies, and no third-party tracking
        cookies. The single cookie this site sets holds your sign-in session, so that signing in
        once covers Enamel Vault, Enamel Vault for kitchens, and the moderation console, which
        are three separate addresses.
      </p>
      <p>
        That is why you were still not shown a cookie banner. Under UK and EU law a banner is
        required in order to ask consent for storage that is <em>not</em> strictly necessary, and
        a cookie that exists purely to keep you signed in to the thing you just signed in to is
        strictly necessary. You cannot refuse it and stay signed in, which is precisely why no
        consent is asked for it.
      </p>

      <h2>What it does store, in your own browser</h2>
      <p>
        A few things are kept in your browser, one as a cookie and the rest in local storage.
        Apart from the sign-in cookie, which is sent to us because that is how you stay signed
        in, these never leave your device and they cannot be read by another site.
        All six exist to make a feature you asked for work, which the law calls strictly
        necessary:
      </p>
      <table>
        <thead>
          <tr>
            <th>What is stored</th>
            <th>What it is for</th>
            <th>How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Your sign-in session</td>
            <td>
              So you stay signed in instead of re-entering your password on every page. Set by
              our authentication provider.
            </td>
            <td>Until you sign out</td>
          </tr>
          <tr>
            <td>
              <code>theme</code>
            </td>
            <td>Remembers whether you chose light or dark, so it does not flicker on load.</td>
            <td>Until you clear it</td>
          </tr>
          <tr>
            <td>
              <code>activeFamilyId</code>
            </td>
            <td>Remembers which family you were last looking at.</td>
            <td>Until you clear it</td>
          </tr>
          <tr>
            <td>
              <code>photo-url:</code> entries
            </td>
            <td>
              Short-lived links to your own photos, so the same photo is not re-requested on
              every page.
            </td>
            <td>Minutes, then discarded</td>
          </tr>
          <tr>
            <td>
              <code>sb-…-auth-token</code> (a cookie)
            </td>
            <td>
              Keeps you signed in. It is set for <code>enamelvault.com</code> and its
              subdomains, so one sign-in covers the recipe app, the kitchen app and the
              moderation console rather than asking you three times. It holds the session token
              your browser exchanges with our database provider, and nothing else. Clearing it
              signs you out, everywhere.
            </td>
            <td>Until you sign out, or a year</td>
          </tr>
          <tr>
            <td>
              <code>cookTimers</code>
            </td>
            <td>
              Keeps any kitchen timer you have started running, so it survives reloading the page
              or leaving the recipe. It holds the recipe, the step number, the duration and the
              time it is due, and nothing about you.
            </td>
            <td>Until the timer finishes or you cancel it</td>
          </tr>
        </tbody>
      </table>
      <p>
        You can delete all of it at any time by clearing site data in your browser settings. The
        only effect is that you will be signed out and the app will forget your theme.
      </p>

      <h2>The one count we do keep</h2>
      <p>
        Our host, Cloudflare, counts page views for us so we can tell whether anything is being
        used at all. It records the page address, the country, and the kind of browser and
        device, and it does this <strong>without cookies and without any identifier for you</strong>.
        It cannot follow you between sessions, cannot build a profile, and cannot recognise you
        on another site. That is precisely why it needs no consent and no banner.
      </p>
      <p>
        We get counts, not people. We cannot tell that the same person came back yesterday and
        today, and we are not trying to.
      </p>

      <h2>Nothing on a page comes from anywhere else</h2>
      <p>
        No embedded videos, no social media widgets, no comment widgets, no maps, no chat
        bubbles, no tag managers, and no fonts loaded from somebody else's network. Every file a
        page needs is served from this domain, so loading a page tells no other company that you
        were here.
      </p>
      <p>
        The typeface used to be loaded from Google Fonts, which meant your browser contacted
        Google on every page load and Google saw your IP address as a result. It is now served
        from this site instead. That was the last third-party request this app made.
      </p>

      <h2>Do Not Track and Global Privacy Control</h2>
      <p>
        We honour both by default, in the only way that means anything: nothing follows you
        between sites, and nothing is stored on your device to recognise you by. What we do
        count is described in the <Link to="/privacy">privacy policy</Link>: a cookieless page
        count, and a dated note of which parts of the app your own account opened. Neither can
        see anything you do anywhere else, which is what these signals are about.
      </p>

      <h2>Questions</h2>
      <p>
        See the <Link to="/privacy">privacy policy</Link> for what happens to your data on the
        server side, or write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}
