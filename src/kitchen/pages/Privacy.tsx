import { Link } from "react-router-dom";
import { CONTACT_EMAIL, KITCHEN_PRIVACY_UPDATED, OPERATOR } from "../../lib/legal";

// The professional kitchen's privacy page. Written against what THIS app actually does, which
// is less than the family app: verified 2026-10-11 that src/kitchen and src/lib/api/kitchen
// contain no fetch, no functions.invoke, no extract-recipe and no errorLog, so the only place
// data goes is Supabase.
//
// THAT ABSENCE IS THE CLAIM MOST WORTH DEFENDING on this page, and supabase/processors.test.ts
// defends it: it fails the build if kitchen code gains an outbound call this page does not
// name. The family page was wrong in production for two weeks about exactly this, by naming
// Google for sign-in while Gemini was reading every photographed recipe card, so a page
// claiming "no AI provider" without a test behind it would be the same mistake twice.
//
// IF THE KITCHEN APP GAINS AN OUTBOUND CALL, this page changes in the same commit. The ones
// easy to forget are the ones nobody thinks of as a processor: a font CDN, an error log, a
// transcription API.
//
// The structural difference from the family page, and the reason this is not a copy of it:
// TWO CONTROLLERS. The operator controls the account; the business controls the kitchen
// content and its staff records, with the operator acting as its processor for those. The
// family app has no such split because a family is not an employer.
export default function Privacy() {
  return (
    <div className="prose plate">
      <h1>Privacy for kitchens</h1>
      <p className="updated">Last updated {KITCHEN_PRIVACY_UPDATED}</p>

      <p>
        The short version: this app keeps your group's dishes so that every site cooks them the
        same way, and it records who approved what. It has no advertising, no tracking pixels
        and no cookies. <strong>There is no AI import on this app</strong>, so nothing you type
        here is sent to an AI company. Nothing is sold or shared for marketing, ever. What
        follows is the detail, because the people whose names end up on a sign-off are entitled
        to it.
      </p>

      <h2>Who is responsible, which is two answers</h2>
      <p>
        This is the one part worth reading twice, because a workplace tool has two sets of data
        in it and they do not have the same owner.
      </p>
      <dl>
        <dt>Your account</dt>
        <dd>
          Your email address, your password and your sign-in belong to you, and {OPERATOR} is
          the data controller for them. Questions about your own account come to the address at
          the bottom of this page.
        </dd>
        <dt>Your group's content, and the staff records in it</dt>
        <dd>
          The dishes, the versions, the sign-offs with names on them and the deviations belong
          to the business that put them here. <strong>That business is the controller</strong>{" "}
          of them, and {OPERATOR} acts as its processor, holding that data on its instructions
          and not using it for anything else. So a question about what your employer can see,
          or a request to delete what you wrote at work, goes to your employer first. They can
          act on it; we act on their instruction.
        </dd>
      </dl>
      <p>
        {OPERATOR} is a private individual in Ohio, in the United States, not a company. There
        is no postal address published; the way to reach a person is{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Your data is stored in the
        United States, and the companies named below operate there too.
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
            <td>Your display name</td>
            <td>So your colleagues know who wrote a dish or approved a version.</td>
          </tr>
          <tr>
            <td>Which group and which site you belong to, and in which role</td>
            <td>
              To decide what you are allowed to see and do. A cook at one site cannot read
              another site's trials, and that is enforced in the database rather than hidden in
              the screen.
            </td>
          </tr>
          <tr>
            <td>Dishes, with every version, ingredient and step</td>
            <td>This is the service. Nothing here is public unless an owner publishes it.</td>
          </tr>
          <tr>
            <td>
              Sign-offs: which version, <strong>which person</strong>, and when
            </td>
            <td>
              This is the answer the app exists to give. It means your approval is attributable
              to you by name, and your colleagues with the right role can see it.
            </td>
          </tr>
          <tr>
            <td>
              Deviations: which site, <strong>which person</strong>, the note and when
            </td>
            <td>
              So a chef can see that one site is cooking it differently, without that note
              overwriting the recipe.
            </td>
          </tr>
          <tr>
            <td>Invite codes</td>
            <td>So an owner can let staff join a group with a link.</td>
          </tr>
          <tr>
            <td>The date and version of the terms you accepted</td>
            <td>
              To know whether to show you updated terms, and to be able to show that agreement
              was actually given.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>What is deliberately NOT collected here</h3>
      <p>
        No error reports. The family app sends a crash report with the error message and the
        page path; this app installs none of that, so a crash here is invisible to us until
        somebody says so. No device fingerprinting, no location data, no advertising
        identifier, and no profile built about you. No photographs yet, because the app has no
        way to upload one.
      </p>

      <h2>Who it is shared with</h2>
      <p>
        Only the companies that run the app, as processors acting on our instructions. Each one
        is listed because the app actually sends data to it:
      </p>
      <dl>
        <dt>Supabase</dt>
        <dd>
          Database, file storage and sign-in. This is where your account and your group's dishes
          actually live. It is the only place this app sends anything.
        </dd>
        <dt>Cloudflare</dt>
        <dd>
          Serves the site. Like every web host it handles your IP address in order to answer the
          request.
        </dd>
        <dt>Google</dt>
        <dd>
          <strong>Sign-in only</strong>, and only if you choose Continue with Google. Nothing
          else on this app reaches Google: loading a page tells them nothing, because the
          typeface is served from our own domain.
        </dd>
      </dl>

      <h3>No AI reads your dishes</h3>
      <p>
        The family app has an AI import that sends a photographed or pasted recipe to a model to
        be read. <strong>This app has no such feature.</strong> Nothing you enter here is sent
        to Google Gemini, to DeepSeek, to Groq, or to any other AI provider, and nothing here is
        used to train a model.
      </p>
      <p>
        That is a claim about today's code rather than a promise about the future, so it is held
        in place mechanically: a test in the codebase fails the build if this app gains an
        outbound call that this page does not name. If an AI feature is ever added here, this
        page says so before it ships, and the date at the top tells you when the list was last
        correct.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        <strong>This app sets no cookies.</strong> It keeps one thing in your browser's local
        storage, a sign-in token, so that you stay signed in between visits, and it is removed
        when you sign out. There is no analytics, no embed and no third-party script, which is
        why you have not been asked to consent to anything: there is nothing to consent to. A
        test fails the build the moment a cookie or a new storage key appears, which is the
        exact moment a consent banner would become mandatory.
      </p>

      <h2>What your employer can see about you</h2>
      <p>
        If you work in a group here, people in it with the right role can see your display name,
        which dishes you wrote or revised, which versions you signed off and when, and which
        deviations you recorded. That is the product doing its job, and you should know it
        rather than discover it.
      </p>
      <p>
        What they cannot see through this app is your email address, your password, or anything
        about your use of the sister family app, which shares your login and shares no data with
        this one.
      </p>

      <h2>Who at our end can see it</h2>
      <p>
        {OPERATOR} runs the servers, which means the data is technically reachable by one
        person, as it is in every small hosted tool. It is not read in the ordinary course of
        things, it is not looked at for product research, and it is not shared. The honest
        statement is that there is no large company's access-control department between your
        dishes and the operator; there is one person's judgement, and the contact address below
        reaches them.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Your group's content is kept until the group deletes it. Leaving a group, or being
        removed from one, does not erase what you wrote or signed off, because that record
        belongs to the business rather than to you: see{" "}
        <Link to="/terms">the terms</Link>. Your account is yours and you can ask for it to be
        deleted at any time.
      </p>
      {/* WHAT DELETION DOES HERE IS A DATABASE FACT, not a promise this page is free to make:
          migration 0059 sets every attribution column in the kitchen schema to null when the
          login goes, and the staff row cascades. The sentences below describe exactly that, so
          if that migration is ever revisited this paragraph is part of the change. Before 0059
          those columns refused the deletion outright, which made the paragraph above false for
          anyone who had done any work here. */}
      <p>
        If you do delete your account, the work stays and your name comes off it. A dish, a
        version, the note saying why it changed, a sign-off and a deviation all survive with the
        person they name set to nobody, because the group is still cooking from them and a
        record of what was decided is no use to anybody blank. Your staff row goes, so you are
        no longer employed there, and an invitation you had sent stops working. A dish your
        group has published stays published: taking it down is the group's decision rather than
        yours, which is the same split as everywhere else on this page. There is no delete
        button in this app yet, which is a gap rather than a policy: write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or use Settings in the family
        app if you have an account there under the same sign-in.
      </p>

      <h2>Your rights</h2>
      <p>
        Wherever you live, you can ask for a copy of your data, ask for it corrected, ask for it
        deleted, object to how it is used, or ask us to restrict it. In the UK and EU these are
        your rights under the UK GDPR and the GDPR; in parts of the US, under your state privacy
        law. We do not ask which, and we do not charge for it.
      </p>
      <p>
        Because of the split at the top of this page, a request about your group's content is
        one your employer decides and we carry out. A request about your own account comes
        straight to us. Either way, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and you will get an answer within
        one month. There is no self-service export yet, which is a gap rather than a policy.
      </p>
      <p>
        If you are in the UK and you think we have got this wrong, you can complain to the
        Information Commissioner at{" "}
        <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer noopener">
          ico.org.uk
        </a>
        . In the EU, to your national data protection authority. Please tell us first if you
        can, because most of these are mistakes we would rather just fix.
      </p>

      <h2>International transfers</h2>
      <p>
        The app runs in the United States, so if you are in the UK or the EEA, using it means
        your data is transferred there. Where that happens we rely on those providers' own
        transfer safeguards, such as standard contractual clauses. {OPERATOR} has not appointed
        a representative in the EU or the UK, because this is a personal project run by one
        person rather than a company; the contact address reaches that person directly.
      </p>

      <h2>Security, honestly stated</h2>
      <p>
        One group cannot read another's dishes, and one site cannot read another site's trials,
        and both of those are enforced at the database level rather than merely hidden in the
        interface, so they stay true even if a screen has a bug. Passwords are hashed by our
        provider.
      </p>
      <p>
        What we will not claim: that this is unbreakable. It is a small app run by one person.
        It is built carefully, and it is not an enterprise system with a security team. Please
        do not keep anything in here that would genuinely harm your business if it leaked, and
        do not make it your only copy of a record you are required to keep.
      </p>
      <p>If something does leak, you will be told.</p>

      <h2>Children</h2>
      <p>
        This is a tool for work and <Link to="/terms">the terms</Link> require you to be at
        least 18. It is not designed for children and we do not knowingly collect data from
        anyone under 18 here.
      </p>

      <h2>Changes</h2>
      <p>
        If this page changes in a way that matters, the date at the top changes and you are asked
        to read the terms again the next time you sign in.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, read by a person. It is shared
        with the sister family app, so say you are writing about a kitchen group. Use it for a
        data request, a complaint, or to tell us something here is wrong.
      </p>
    </div>
  );
}
