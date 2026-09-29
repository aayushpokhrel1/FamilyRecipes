// A plain-English acceptable-use page. Deliberately short: a document nobody reads is worse
// than a short one people might. Aayush owns the wording; this is a starting draft, and the
// contact address is the one thing here that MUST be kept true.
//
// TermsGate renders a link to this page, and it sits OUTSIDE RequireAuth in routes.tsx so a
// signed-out visitor can read it before deciding to sign up.
export const TERMS_CONTACT = "moderation@enamelvault.com";

export default function Terms() {
  return (
    <div className="prose">
      <h1>Terms and acceptable use</h1>
      <p>
        Family Recipes is a place to keep your family's recipes and, if you choose, to share
        some of them. Most of what follows is one idea: publish only what is yours to publish,
        and be someone other cooks would want in their kitchen.
      </p>

      <h2>Your recipes stay yours</h2>
      <p>
        Everything you add belongs to you. Recipes are private to your family unless you
        publish them. Publishing a recipe makes it readable by anyone with the link, and lets
        other cooks save a copy into their own vault.
      </p>
      <p>
        A saved copy is a real copy. If you later unpublish or delete a recipe, copies already
        saved stay in the vaults that saved them, credited to you. That is deliberate: it means
        nobody's vault can be emptied by someone else's decision.
      </p>

      <h2>What you may publish</h2>
      <ul>
        <li>Recipes you wrote, or your family's recipes you are entitled to share.</li>
        <li>
          Recipes adapted from a book, a site or another cook, where you say where they came
          from. Ingredients and methods are not copyrightable, but somebody's written words and
          photographs are.
        </li>
      </ul>

      <h2>What gets removed</h2>
      <p>A published recipe can be removed from the public side of the app if it is:</p>
      <ul>
        <li>not a recipe;</li>
        <li>abusive, hateful, harassing, or sexual content;</li>
        <li>somebody else's work, published without the right to do so;</li>
        <li>an attempt to pass yourself off as someone you are not;</li>
        <li>spam, advertising, or an attempt to break or misuse the app.</li>
      </ul>
      <p>
        Removal means the recipe stops being public. <strong>It stays in your vault</strong>,
        and you are told the reason on the recipe itself. An account that keeps doing this can
        be suspended from publishing, which also takes its published recipes down.
      </p>

      <h2>Reporting something</h2>
      <p>
        Every published recipe has a Report control. Reports are read by a person, not a
        machine, so allow some time. If you think something was removed wrongly, write to the
        address below and say so.
      </p>

      <h2>Your account and your data</h2>
      <p>
        You can delete your account from Settings, which removes your recipes and your profile.
        Copies other cooks saved before then remain in their vaults, for the reason given
        above.
      </p>

      <h2>Contact</h2>
      <p>
        A person reads <a href={`mailto:${TERMS_CONTACT}`}>{TERMS_CONTACT}</a>. Use it for
        reports, complaints, takedown requests, or anything about your own data.
      </p>
    </div>
  );
}
