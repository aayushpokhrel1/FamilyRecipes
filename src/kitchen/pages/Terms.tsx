import { Link } from "react-router-dom";
import { CONTACT_EMAIL, KITCHEN_TERMS_UPDATED, OPERATOR } from "../../lib/legal";

// The professional kitchen's terms. A SEPARATE document from src/pages/Terms.tsx, not a copy
// of it: the parties differ (a business's staff rather than a private cook), the data differs
// (dishes, sign-offs, deviations and staff records rather than family recipes), and the way
// this product goes wrong differs.
//
// CHANGING THE WORDING BELOW? Bump KITCHEN_TERMS_VERSION in components/KitchenTermsGate.tsx and
// KITCHEN_PRIVACY_UPDATED's sibling KITCHEN_TERMS_UPDATED in lib/legal.ts, or nobody is
// re-asked and the stored acceptance claims people agreed to text they never saw.
// KitchenTermsGate.version.test.ts FAILS if you forget.
//
// This page sits OUTSIDE the terms gate in routes.tsx, like the family app's four public
// documents: a notice you can only read after consenting is not a notice.
//
// FOUR SECTIONS HERE ARE LOAD-BEARING AND MUST NOT BE SOFTENED TO SAVE WORDS. The version
// test asserts each one's presence:
//   - "A sign-off is a record, not a certification", because the app stores that a named
//     person approved a version, and a reader could easily mistake that for a safety check
//     that something in here performed. Nothing in here performs one.
//   - "Whose dishes these are", which is the only thing saying the content belongs to the
//     business rather than to the operator or to the person who typed it.
//   - "Publishing a dish", because publish_dish writes into the family app's public side and
//     a takedown cannot recall the copies family cooks already saved. That is 0044 and 0045
//     behaviour, and an owner has to know it before pressing the button, not after.
//   - "What is not promised", the warranty disclaimer and the liability cap, and "Which law
//     applies", which names Ohio. No forum named means being sued anywhere.
export default function Terms() {
  return (
    <div className="prose plate">
      <h1>Terms for kitchens</h1>
      <p className="updated">Last updated {KITCHEN_TERMS_UPDATED}</p>
      <p>
        Enamel Vault for kitchens is a place for a group of kitchens to write a dish up once and
        have every site cook it the same way, with a clear answer to "which version are we on
        and who approved it". This page is the agreement for using it. It is short because a
        document nobody reads is worse than a short one people might.
      </p>
      <p>
        It is free, it is in development, and it is run by one person. Those three facts shape
        most of what follows, so they are stated at the top rather than buried.
      </p>

      <h2>Who may use it</h2>
      <p>
        You need to be at least 18, because this is a tool for work rather than a consumer app.
      </p>
      <p>
        You are also using it <strong>on your employer's behalf</strong>. By accepting these
        terms you are telling us you have your employer's agreement to put their recipes, their
        sites and their staff's names into it. If you are not sure you have that, ask before you
        start rather than after, because what goes in is hard to take back out of other people's
        heads.
      </p>

      <h2>Whose dishes these are</h2>
      <p>
        Everything entered here, the dishes, their versions, the sign-offs, the deviations and
        the staff names, <strong>belongs to the business</strong> it describes. It does not
        belong to {OPERATOR} and it does not become yours by being the one who typed it.
      </p>
      <p>
        So that the app can actually work, you give {OPERATOR} permission to store, copy and
        display that content for the purpose of running it and showing it to the people in your
        group who are meant to see it. That is all it covers. It is not permission to sell your
        recipes, to show a dish to anyone outside your group, to publish one you did not
        publish, or to train an AI model on them, and none of those things happen.
      </p>

      <h2>A sign-off is a record, not a certification</h2>
      <p>
        When a chef signs a version off, this app stores the fact that a named person approved
        that version on that date. That is a record of what somebody decided. It is{" "}
        <strong>not a certification</strong> that the dish is safe, compliant, correctly costed
        or correctly labelled, and nothing in this app checks any of that for you.
      </p>
      <p>
        Being specific, because a vague disclaimer is no use to a head chef:{" "}
        <strong>
          this app does not check allergens, does not verify a yield, does not calculate a
          portion cost and does not validate a temperature, a shelf life or a storage
          instruction.
        </strong>{" "}
        It stores what your people typed and shows it back to them unaltered.
      </p>
      <p>
        Your legal duties stay entirely yours. Nothing here discharges a HACCP plan, allergen
        labelling law, local food hygiene rules, or any inspection or record-keeping duty you
        are under. If a sign-off in this app and your HACCP documentation disagree, your
        documentation is the one that counts.
      </p>
      <p>
        <strong>
          Do not make this app the only copy of a record you are legally required to keep.
        </strong>{" "}
        It is a free tool in development, run by one person, with no promise below that it will
        be available or that it will not lose data. Keep your own copy of anything an inspector
        might ask for.
      </p>

      <h2>The records have names on them</h2>
      <p>
        This app stores <strong>who signed a version off</strong> and when, and who recorded a
        deviation and when. People in your group with the right role can see that, which is the
        feature working rather than a leak: the whole point is that there is one answer to who
        approved what.
      </p>
      <p>
        It also stores <strong>the days each person opened the app</strong> and which section
        they opened, per group, and shows that to the group&apos;s owner against their name. The
        owner alone sees it, it is counted in days rather than in visits, and an owner of one
        group cannot see the days you opened another.
      </p>
      <p>
        It is worth saying plainly all the same, because the people whose names those are should
        know. If you are rolling this out to a team, tell them, and tell them about that last
        part in particular. The <Link to="/privacy">privacy page</Link> sets out what is stored
        about each person and who can see it.
      </p>

      <h2>Deviations are a note, not a change</h2>
      <p>
        When a site records that it does something differently, that is stored against the group
        version rather than replacing it. Nobody's note overwrites the chef's recipe, and the
        chef can see that a site has drifted. If a deviation should become the recipe, somebody
        has to revise the dish deliberately.
      </p>

      <h2>Publishing a dish</h2>
      <p>
        An owner can publish a finished dish publicly, as marketing. Doing that puts it on the
        public side of Family Recipes, the sister app, under your venue's name rather than a
        person's. Anyone with the link can then read it, and family cooks there can save a copy
        into their own collection.
      </p>
      <p>
        <strong>That is the step you cannot fully take back.</strong> Taking a dish down removes
        the public page, and it does not reach into anybody's collection: the{" "}
        <strong>copies already saved</strong> stay where they are, credited to your venue.
        Deciding to publish is deciding that, so decide it with the recipe in front of you.
      </p>

      <h2>What gets removed</h2>
      <p>A published dish can be taken off the public side if it is:</p>
      <ul>
        <li>not a recipe;</li>
        <li>somebody else's work, published without the right to do so;</li>
        <li>an attempt to pass your group off as a business it is not;</li>
        <li>abusive or sexual content;</li>
        <li>spam, advertising, or an attempt to break or misuse the app.</li>
      </ul>
      <p>
        Removal means it stops being public. It stays in your group, and you are told the
        reason. If you think it was wrong, write to the address below and say so.
      </p>

      <h2>Payments</h2>
      <p>
        This is free. There is nothing to buy, no subscription, no trial that turns into one,
        and the app never asks for card or bank details. Because no money changes hands,{" "}
        <strong>there is nothing to refund</strong>, and there is no contract for a service
        level, support response or uptime.
      </p>
      <p>
        If a paid version is ever introduced, it will be priced and agreed before any payment is
        taken, and these terms will be updated first with a refund and cancellation position.
        You would not be charged for something you already have for free.
      </p>

      <h2>Your account, and leaving</h2>
      <p>
        An owner can remove a member of staff from a group, which ends their access to it. The
        content stays with the business, including anything that person wrote or signed off,
        because the record belongs to the business rather than to the individual.
      </p>
      <p>
        If you want a copy of what your group has put in, or something corrected, write to the
        address below. There is no self-service export yet, which is an honest gap rather than a
        policy, and asking gets you the data.
      </p>

      <h2>What is not promised</h2>
      <p>
        This app is offered <strong>as it is</strong>. It is a personal project in development,
        not a product with a support contract, and there is no promise that it will be
        available, that it will not lose data, that it will keep existing, or that anything in
        it is accurate or fit for a particular purpose. All warranties that can be disclaimed
        are disclaimed, including the implied warranties of merchantability, fitness for a
        particular purpose and non-infringement.
      </p>
      <p>
        So far as the law allows, {OPERATOR} is not liable for indirect, incidental or
        consequential losses, for lost data, for lost profit or trade, or for anything that
        follows from a dish, a cost, an allergen note or a sign-off in here being wrong. Where
        liability cannot be excluded, it is limited to one hundred US dollars in total, which
        reflects that you pay nothing for this.
      </p>
      <p>
        Two things are deliberately not limited, because limiting them would be wrong and in
        many places is not permitted anyway: death or personal injury caused by negligence, and
        fraud.
      </p>

      <h2>If you cause a problem</h2>
      <p>
        If somebody brings a claim against {OPERATOR} because of what your group published, for
        instance because a dish you published was somebody else's work, you agree to cover the
        reasonable cost of dealing with it.
      </p>

      <h2>Who you are agreeing with</h2>
      <p>
        Enamel Vault for kitchens is run by {OPERATOR}, a private individual in Ohio, in the
        United States, rather than a company. You are agreeing personally, as the person using
        it. Your employer is not a party to this, which is also why you confirmed above that you
        have their agreement to be here.
      </p>
      <p>
        What is stored about you and about your colleagues is a separate document, because it is
        a separate promise: see the <Link to="/privacy">privacy page</Link>. It is the one worth
        reading before you invite a team.
      </p>

      <h2>Which law applies</h2>
      <p>
        These terms are governed by the law of the State of Ohio, in the United States, and a
        dispute belongs in the state or federal courts for Franklin County, Ohio. There is no
        forced arbitration here and no class action waiver.
      </p>

      <h2>If these terms change</h2>
      <p>
        When the wording here changes in a way that matters, the date at the top changes and you
        are asked to read and accept it again the next time you sign in.
      </p>

      <h2>Contact</h2>
      <p>
        A person reads <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. It is shared with
        the sister app, so say that you are writing about a kitchen group and it will reach the
        right place. Use it for a data request, a takedown, a correction, or to tell us something
        here is wrong.
      </p>
    </div>
  );
}
