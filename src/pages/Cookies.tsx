import { Link } from "react-router-dom";
import { CONTACT_EMAIL, COOKIES_UPDATED } from "../lib/legal";

// There is no cookie banner in this app, and that is a deliberate consequence of this page
// being TRUE: the app sets no cookies, and the only browser storage it uses is strictly
// necessary, which UK/EU law exempts from consent. The banner is not skipped, it is unnecessary.
//
// THE DAY THAT STOPS BEING TRUE, A BANNER BECOMES MANDATORY. It stops being true the moment
// anyone adds analytics, an ad script, an embedded video, a social widget, or any storage that
// is not required for a feature the user asked for. The keys listed below are the whole set;
// they are asserted by src/lib/browserStorage.test.ts, which fails when a new one appears.
export default function Cookies() {
  return (
    <div className="prose plate">
      <h1>Cookies and local storage</h1>
      <p className="updated">Last updated {COOKIES_UPDATED}</p>

      <h2>This site sets no cookies</h2>
      <p>
        Not one. There are no advertising cookies, no analytics cookies, and no third-party
        tracking cookies, because the app has no advertising and no analytics at all. That is
        also why you were not shown a cookie banner: under UK and EU law a banner is required in
        order to ask consent for non-essential storage, and there is none to ask about.
      </p>

      <h2>What it does store, in your own browser</h2>
      <p>
        A few things are kept in your browser local storage. These never leave your device, they
        are not sent to us, and they cannot be read by another site. All four exist to make a
        feature you asked for work, which is what the law calls strictly necessary:
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
        </tbody>
      </table>
      <p>
        You can delete all of it at any time by clearing site data in your browser settings. The
        only effect is that you will be signed out and the app will forget your theme.
      </p>

      <h2>The one thing your browser fetches from elsewhere</h2>
      <p>
        The site loads its typeface from Google Fonts. That means your browser makes a request to
        Google when a page loads, and Google sees your IP address as a result, as it would for
        any file served from its network. No cookie is set by it and nothing identifies you to
        us. We would rather this request did not happen at all, and serving the font from our own
        domain is on the list of things to fix.
      </p>
      <p>
        Other than that, there are no embedded videos, no social media widgets, no comment
        widgets, no maps, no chat bubbles and no tag managers. Nothing on a page comes from a
        third party except that font.
      </p>

      <h2>Do Not Track and Global Privacy Control</h2>
      <p>
        We honour both by default, in the only way that means anything: there is no tracking to
        turn off.
      </p>

      <h2>Questions</h2>
      <p>
        See the <Link to="/privacy">privacy policy</Link> for what happens to your data on the
        server side, or write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}
