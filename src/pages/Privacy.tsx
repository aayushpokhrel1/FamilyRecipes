import { Link } from "react-router-dom";
import { CONTACT_EMAIL, OPERATOR, PRIVACY_UPDATED } from "../lib/legal";

// Written against what the code ACTUALLY does, not against a template. Every processor named
// below is one the app really talks to, and every field named is one a table really stores.
//
// IF YOU ADD A PROCESSOR, ADD IT HERE. The ones that are easy to forget are the ones nobody
// thinks of as a processor: a font CDN, an error log, a transcription API. The current list
// comes from supabase/functions/* env vars, index.html's font link, and src/lib/api/errorLog.ts.
export default function Privacy() {
  return (
    <div className="prose plate">
      <h1>Privacy policy</h1>
      <p className="updated">Last updated {PRIVACY_UPDATED}</p>

      <p>
        The short version: this app keeps your recipes so you and your family can cook from
        them. It has no advertising, no tracking pixels and no cookies, and the only analytics
        is a cookieless page count that cannot identify you. Nothing here is sold or shared for
        marketing, ever. What follows is the detail, because you are entitled to it.
      </p>

      <h2>Who is responsible for your data</h2>
      <p>
        Family Recipes is run by {OPERATOR}, a private individual, not a company. For data
        protection purposes that makes {OPERATOR} the data controller. There is no postal
        address published; the way to reach a person is{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, which a human reads.
      </p>

      <h2>What is collected, and why</h2>
      <table>
        <thead>
          <tr>
            <th>What</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email address and password</td>
            <td>
              To create your account and let you sign back in. Passwords are stored hashed by
              our authentication provider; nobody, including {OPERATOR}, can read them.
            </td>
          </tr>
          <tr>
            <td>Display name, handle, and avatar if you upload one</td>
            <td>
              So your family knows who added a recipe, and so a published recipe can be
              credited to a cook.
            </td>
          </tr>
          <tr>
            <td>Your recipes, photos, stories, comments and meal plans</td>
            <td>This is the service. Private to your family unless you publish them.</td>
          </tr>
          <tr>
            <td>Which families you belong to</td>
            <td>To decide what you are allowed to see.</td>
          </tr>
          <tr>
            <td>The date and version of the terms you accepted</td>
            <td>
              To know whether to show you updated terms, and to be able to show that agreement
              was actually given.
            </td>
          </tr>
          <tr>
            <td>Reports you make, and moderation decisions about your recipes</td>
            <td>To act on reports and to tell you when something of yours was removed.</td>
          </tr>
          <tr>
            <td>
              Error reports: the error message, the page path, and your browser user-agent
              string
            </td>
            <td>
              So a crash is visible without someone having to notice and complain. Full URLs,
              query strings and page contents are deliberately not recorded.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        That is the whole list. There is no device fingerprinting, no location data, no contacts
        import, no advertising identifier, and no profile built about you.
      </p>

      <h2>Lawful basis (UK and EU)</h2>
      <ul>
        <li>
          <strong>Performing our agreement with you</strong> for your account, your recipes and
          anything needed to show them to the right people.
        </li>
        <li>
          <strong>Legitimate interests</strong> for keeping the app secure and working: error
          logs, abuse reports and moderation. The interest is a service that is safe to use and
          does not silently break.
        </li>
        <li>
          <strong>Consent</strong> for the optional things you choose to switch on: publishing a
          recipe publicly, and using the AI recipe import described below. You can stop either
          at any time.
        </li>
      </ul>

      <h2>Who it is shared with</h2>
      <p>
        Only the companies that run the app for us, as processors acting on our instructions.
        Each one is listed here because the app actually sends data to it:
      </p>
      <dl>
        <dt>Supabase</dt>
        <dd>
          Database, file storage and sign-in. This is where your account and your recipes
          actually live.
        </dd>
        <dt>Cloudflare</dt>
        <dd>
          Serves the site. Like every web host it handles your IP address in order to answer the
          request. It also counts page views for us, without cookies and without any identifier
          that could single you out or follow you between visits. See{" "}
          <Link to="/cookies">Cookies and local storage</Link>.
        </dd>
        <dt>Google</dt>
        <dd>
          Only if you choose Continue with Google to sign in. Nothing else on this site reaches
          Google: the typeface is served from our own domain, so simply loading a page tells
          Google nothing. See <Link to="/cookies">Cookies and local storage</Link>.
        </dd>
        <dt>Resend</dt>
        <dd>Sends the notification email when a recipe is reported.</dd>
        <dt>DeepSeek, and Groq if you dictate a recipe</dt>
        <dd>
          <strong>Only when you use the AI import.</strong> If you paste a recipe, a link, a
          photo or a voice note into the import panel, that content is sent to an AI provider to
          be turned into structured ingredients and steps. It is not used to advertise to you,
          but it does leave our infrastructure and it may be processed outside the UK and EU,
          including in countries whose data protection law differs from yours. If you would
          rather that never happened, type the recipe in by hand; every field the importer fills
          can be filled by you instead.
        </dd>
      </dl>
      <p>
        Nobody buys this data, because it is not for sale. We do not sell or share personal
        information for cross-context behavioural advertising, which is the specific thing US
        state privacy laws give you a right to opt out of. There is nothing to opt out of here.
      </p>

      <h2>International transfers</h2>
      <p>
        The providers above operate outside the UK and the EEA, and the AI import in particular
        may process your text outside both. Where that happens we rely on those providers own
        transfer safeguards, such as standard contractual clauses. If this matters to you, the AI
        import is the one feature to avoid, and avoiding it costs you nothing but typing.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Your account and recipes are kept until you delete them. Delete your account from
        Settings and your recipes, photos and profile go with it. Two things deliberately
        survive:
      </p>
      <ul>
        <li>
          Copies of a recipe that other cooks saved into their own vaults before you deleted it,
          credited to you. This is explained in the <Link to="/terms">terms</Link>: nobody can
          have their vault emptied by someone else making a decision.
        </li>
        <li>
          Moderation records of a removal, kept so a repeated pattern can be acted on. These
          hold the decision, not your recipes.
        </li>
      </ul>
      <p>Error reports are operational data and are cleared out as they age.</p>

      <h2>Your rights</h2>
      <p>
        Wherever you live, you can ask for a copy of your data, ask for it corrected, ask for it
        deleted, object to how it is used, or ask us to restrict it. In the UK and EU these are
        your rights under the UK GDPR and the GDPR; in parts of the US, under your state privacy
        law. We do not ask which, and we do not charge for it.
      </p>
      <p>
        You can do the two big ones yourself, immediately: edit or delete any recipe, and delete
        your whole account from Settings. For anything else, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and you will get an answer within
        one month. We will never make you pay, sign up for anything, or justify the request.
      </p>
      <p>
        If you are in the UK and you think we have got this wrong, you can complain to the
        Information Commissioner at{" "}
        <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer noopener">
          ico.org.uk
        </a>
        . In the EU, to your national data protection authority. Please tell us first if you can,
        because most of these are mistakes we would rather just fix.
      </p>

      <h2>Children</h2>
      <p>
        This app is meant for adults keeping family recipes. It is not designed for children, we
        do not knowingly collect data from anyone under 13, and if we learn that we have, the
        account is deleted. Nothing here is targeted or advertised to children.
      </p>

      <h2>Security, honestly stated</h2>
      <p>
        Your family recipes are kept private at the database level, so one family cannot read
        another even if the app has a bug in the page that displays them. Photos are served
        through links that expire. Passwords are hashed by our provider.
      </p>
      <p>
        What we will not claim: that this is unbreakable. It is a small app run by one person. It
        is built carefully, and it is not a bank. Please do not keep anything in here that would
        genuinely harm you if it leaked.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, the date at the top changes and you will be
        asked to read the terms again the next time you sign in.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, read by a person. Use it for a
        data request, a complaint, a takedown, or to tell us something here is wrong.
      </p>
    </div>
  );
}
