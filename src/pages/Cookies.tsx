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
        tracking cookies. That is why you were not shown a cookie banner: under UK and EU law a
        banner is required in order to ask consent for non-essential storage, and there is none
        to ask about.
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
