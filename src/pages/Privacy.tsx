import { Link } from "react-router-dom";
import { CONTACT_EMAIL, OPERATOR, PRIVACY_UPDATED } from "../lib/legal";

// Written against what the code ACTUALLY does, not against a template. Every processor named
// below is one the app really talks to, and every field named is one a table really stores.
//
// IF YOU ADD A PROCESSOR, ADD IT HERE. The ones that are easy to forget are the ones nobody
// thinks of as a processor: a font CDN, an error log, a transcription API. The current list
// comes from supabase/functions/* env vars, index.html's font link, and src/lib/api/errorLog.ts.
//
// THIS IS NO LONGER ONLY A PROMISE: supabase/processors.test.ts reads the outbound hostnames
// out of the code and the deployable alternatives out of docs/OPERATIONS.md, and FAILS if one
// of them is not named on this page. It was written because this page was wrong in production
// for two weeks: the AI import's primary provider had been switched to Google Gemini while
// this page still said, under Google, that nothing but sign-in ever reached Google.
//
// The AI provider is an ENV VAR (MODEL_BASE_URL), so "who receives a user's recipe" is a
// deploy-time decision, not a code one. That is why the section below names the companies AND
// says the list can change, and why changing that secret means editing this page in the same
// breath.
export default function Privacy() {
  return (
    <div className="prose plate">
      <h1>Privacy policy</h1>
      <p className="updated">Last updated {PRIVACY_UPDATED}</p>

      <p>
        The short version: this app keeps your recipes so you and your family can cook from
        them. It has no advertising, no tracking pixels and no cookies, and the only analytics
        is a cookieless page count that cannot identify you. Nothing here is sold or shared for
        marketing, ever. The one thing that does leave our own systems is anything you put
        through the AI import, and the section on sharing names exactly who receives it. What
        follows is the detail, because you are entitled to it.
      </p>

      <h2>Who is responsible for your data</h2>
      <p>
        Family Recipes is run by {OPERATOR}, a private individual in Ohio, in the United States,
        not a company. For data protection purposes that makes {OPERATOR} the data controller.
        There is no postal address published; the way to reach a person is{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, which a human reads.
      </p>
      <p>
        Your account, your recipes and your photos are stored in the United States, and the
        companies named below operate there too. If you are reading this from outside the US,
        that is where your data lives.
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
              query strings and page contents are deliberately not recorded. These are deleted
              after 90 days.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        That is the whole list. There is no device fingerprinting, no location data, no contacts
        import, no advertising identifier, and no profile built about you.
      </p>

      <h2>Lawful basis (UK and EU)</h2>
      <p>
        This app is run from the United States and is not aimed at Europe, but people in the UK
        and the EU use it, so here is the basis for each thing it does.
      </p>
      <ul>
        <li>
          <strong>Performing our agreement with you</strong> for your account, your recipes,
          anything needed to show them to the right people, and the AI import when you choose to
          use it. The import is a feature you asked for by using it, and it cannot be delivered
          without sending your text, photo or recording to the provider that reads it. The panel
          says so before you use it, and nothing is sent until you press the button.
        </li>
        <li>
          <strong>Legitimate interests</strong> for keeping the app secure and working: error
          logs, abuse reports and moderation. The interest is a service that is safe to use and
          does not silently break.
        </li>
        <li>
          <strong>Consent</strong> for publishing a recipe publicly, which you give by choosing
          to publish it and withdraw by unpublishing it. The copies other cooks already saved are
          the one thing that does not come back, which the <Link to="/terms">terms</Link> explain
          before you publish.
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
          Two separate things, and the second one is the one people do not expect. First, sign-in,
          but only if you choose Continue with Google. Second, <strong>the AI import</strong>:
          the model that reads your recipe is Google Gemini today, so a photo of a recipe card, a
          pasted recipe, a link or a voice note that you put through the importer is sent to
          Google to be turned into ingredients and steps. Simply loading a page still tells Google
          nothing, because the typeface is served from our own domain. See the AI import entry
          below for what that means and how to avoid it.
        </dd>
        <dt>DeepSeek</dt>
        <dd>
          The same job as Gemini, used only when Gemini fails or is unavailable, so that the
          importer degrades instead of breaking. It receives the same content in that case.
        </dd>
        <dt>Groq</dt>
        <dd>
          Transcribes a voice note into text, and only if you use Voice mode. Your recording goes
          to Groq first, and the transcript then goes to the model above.
        </dd>
        <dt>Resend</dt>
        <dd>Sends the notification email when a recipe is reported.</dd>
      </dl>

      <h3>What the AI import means for you</h3>
      <p>
        <strong>Nothing is sent to any AI company unless you use the import.</strong> If you type
        a recipe in by hand, it goes to our database and nowhere else. Every field the importer
        fills can be filled by you instead, so avoiding this costs you nothing but typing.
      </p>
      <p>
        When you do use it, what you pasted, photographed or recorded leaves our infrastructure
        and is processed by the companies above, in the United States and potentially elsewhere,
        including countries whose data protection law differs from your own. It is not used to
        advertise to you. We do not permit it to be used to train their models, and these
        providers state that content sent through their paid interfaces is not used for training,
        but we cannot audit that for you, so treat the import as the one place where a recipe
        leaves our hands.
      </p>
      <p>
        Which company does this work is a configuration setting rather than a rewrite, so it can
        change. When it does, this page changes at the same time: a test in the codebase fails the
        build if a provider the app can send content to is not named here. The date at the top
        tells you when the list was last correct.
      </p>
      <p>
        Nobody buys this data, because it is not for sale. We do not sell or share personal
        information for cross-context behavioural advertising, which is the specific thing US
        state privacy laws give you a right to opt out of. There is nothing to opt out of here.
      </p>

      <h2>Who at our end can see your account</h2>
      <p>
        Family Recipes has moderators, and today that is one person: {OPERATOR}, who also runs
        the site. A moderator can see the list of accounts, which means your email address, your
        display name, when you joined and when you last signed in. They can suspend an account,
        take a published recipe down, or delete an account.
      </p>
      <p>
        <strong>A moderator cannot read your recipes.</strong> Private and family recipes are
        closed to them at the database level, not merely hidden in the interface, and that stays
        true no matter what the moderation screen is asked to show. What they can act on is what
        you chose to publish.
      </p>
      <p>
        If your account is suspended or something of yours is taken down, you are told, and you
        are told the reason. You can challenge it at the address below.
      </p>

      <h2>International transfers</h2>
      <p>
        The app runs in the United States, so if you are in the UK or the EEA, using it means
        your data is transferred there. The AI import may additionally be processed outside both.
        Where that happens we rely on those providers own transfer safeguards, such as standard
        contractual clauses. {OPERATOR} has not appointed a representative in the EU or the UK,
        because this is a personal project run by one person rather than a company; the contact
        address below reaches that person directly, and a data request sent there is answered the
        same way a representative would have to answer it.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Your account and recipes are kept until you delete them. Delete your account from
        Settings and your login, your profile and your public identity (your handle, public
        name, bio and photo, including the image file itself) are erased, along with your meal
        plans, your unfinished recipe drafts, and who you were following. Recipes you wrote are
        not deleted along with the account: they stay in the family vaults they belong to,
        credited to &ldquo;a former member&rdquo; rather than to you. Delete the recipes you
        want gone before you delete the account, or ask us and we will do it.
      </p>
      <p>These things deliberately survive, and this is the whole list:</p>
      <ul>
        <li>
          Recipes you added to a family vault, and the photos, comments and &ldquo;cooked
          this&rdquo; entries that go with them. They are what the vault is for and the other
          members are relying on them, so they stay, credited to &ldquo;a former member&rdquo;.
          Anything written in a comment stays visible to that family.
        </li>
        <li>
          Copies of a recipe that other cooks saved into their own vaults before you deleted it,
          credited to you. This is explained in the <Link to="/terms">terms</Link>: nobody can
          have their vault emptied by someone else making a decision.
        </li>
        <li>
          Moderation records: a report you filed, an appeal you wrote, and the record of a
          removal, kept so a repeated pattern can be acted on. These hold the decision, not
          your recipes.
        </li>
      </ul>
      <p>Error reports are operational data and are deleted after 90 days.</p>

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
        one month. We will never make you pay, sign up for anything, or justify the request. We
        will never treat you differently for asking.
      </p>
      <p>
        If you are in the United States, several states give their residents these rights by
        statute, and some of those laws only bite on larger businesses than this one. We do not
        rely on that distinction: the rights above are offered to everybody, in the same way,
        whichever state you are in.
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
        This app is meant for adults keeping family recipes, and the{" "}
        <Link to="/terms">terms</Link> set a minimum age of 13. It is not designed for children,
        we do not knowingly collect data from anyone under 13, and if we learn that we have, the
        account is deleted. Nothing here is targeted or advertised to children. If you are a
        parent and you think your child has an account here, write to the address below and it
        will be removed.
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
      <p>
        If something does leak, you will be told. Ohio law requires it and it is the right thing
        to do regardless.
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
