import { Link } from "react-router-dom";
import { CONTACT_EMAIL, OPERATOR } from "../lib/legal";

// The one page that answers "who is behind this and how do I reach them", which is what both
// UK/EU consumer-information rules and plain decency ask for. It is public on purpose: someone
// deciding whether to sign up must be able to read it without an account.
export default function Help() {
  return (
    <div className="prose plate">
      <h1>Help</h1>

      <h2>What this is</h2>
      <p>
        A place to keep your family recipes: the ingredients, the method, the photo, and the
        story that goes with it. Recipes are private to your family by default. You can publish
        one if you want other cooks to find it, and you can unpublish it again.
      </p>

      <h2>Getting started</h2>
      <dl>
        <dt>Add a recipe</dt>
        <dd>
          Recipes, then New recipe. Type it in, or paste a block of text, a link, a photo or a
          voice note into the import panel and let it fill the fields in for you. Always read
          what it filled in: it guesses, and it is sometimes wrong.
        </dd>
        <dt>Share with your family</dt>
        <dd>
          Families, then create a family and send the join code to the people you want in it.
          Anyone in the family can see that family recipes.
        </dd>
        <dt>Publish a recipe</dt>
        <dd>
          Open the recipe, change its visibility to published. It then has a public page anyone
          with the link can read, and other cooks can save a copy into their own vault.
        </dd>
        <dt>Cook from it</dt>
        <dd>
          Cook mode gives you one big step at a time, so you are not squinting at a phone with
          floury hands. Change the portions and the quantities follow.
        </dd>
        <dt>Plan a week</dt>
        <dd>
          My Kitchen holds meal plans and a grocery list built from the recipes you planned, with
          the things you already have in your cupboard left off it.
        </dd>
      </dl>

      <h2>Something is wrong with a published recipe</h2>
      <p>
        Every published recipe has a Report control. A person reads reports, so allow a little
        time. What gets removed, and what happens to your copy if something of yours is removed,
        is set out in the <Link to="/terms">terms</Link>.
      </p>

      <h2>Your data and your account</h2>
      <p>
        You can delete any recipe, and you can delete your whole account from Settings, which
        takes your recipes, photos and profile with it. The{" "}
        <Link to="/privacy">privacy policy</Link> explains exactly what is stored and the two
        things that deliberately survive a deletion. If you want a copy of your data, ask.
      </p>

      <h2>Accessibility</h2>
      <p>
        The aim is WCAG 2.2 AA. Every page works with a keyboard alone, text and controls meet AA
        contrast in both light and dark themes, and the app respects your system setting for
        reduced motion. It has not been audited by anyone but us, so if something is unusable for
        you, please say so and it gets fixed ahead of other work.
      </p>

      <h2>Does it cost anything</h2>
      <p>
        No. Family Recipes is free, there is nothing to buy, no subscription, no trial and no
        card details anywhere in the app. Because of that there is nothing to refund; see
        Payments and refunds in the <Link to="/terms">terms</Link>. If that ever changes, you
        would be told clearly before being asked for money, never signed up automatically.
      </p>

      <h2>Who runs this</h2>
      <p>
        Family Recipes is run by {OPERATOR}, one person, not a company. It is a personal project,
        not a business, and there is no support team behind it. Emails are answered by the same
        person who wrote the app.
      </p>
      <p>
        Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Use it for help, a bug,
        a report, a complaint, a takedown request, an accessibility problem, or anything about
        your own data.
      </p>

      <h2>The rest</h2>
      <ul>
        <li>
          <Link to="/terms">Terms and acceptable use</Link>
        </li>
        <li>
          <Link to="/privacy">Privacy policy</Link>
        </li>
        <li>
          <Link to="/cookies">Cookies and local storage</Link>
        </li>
      </ul>
    </div>
  );
}
