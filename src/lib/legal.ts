// The facts the legal and help pages all repeat. One home, because four pages disagreeing
// about the contact address is worse than no pages at all.
//
// OPERATOR and CONTACT_EMAIL are the identity of the data controller. Under UK/EU GDPR a
// policy MUST name an identifiable controller and a working contact route, so neither of
// these may become a placeholder or a dead mailbox. CONTACT_EMAIL is the same address the
// moderation queue notifies (MODERATION_EMAIL in the notify-report function); if that env
// var ever changes, change this too.
export const OPERATOR = "Aayush Pokhrel";
export const CONTACT_EMAIL = "moderation@enamelvault.com";

// Shown on each policy page. BUMP THE DATE WHEN YOU CHANGE THAT PAGE'S WORDING, and if you
// change Terms.tsx, bump TERMS_VERSION in TermsGate.tsx as well so people are re-asked.
export const PRIVACY_UPDATED = "26 October 2026";
export const COOKIES_UPDATED = "16 October 2026";
export const TERMS_UPDATED = "11 October 2026";

// The PROFESSIONAL KITCHEN app's documents, dated separately from the family app's above.
// Separate on purpose rather than by oversight: they are a different product with different
// parties, so a kitchen clause must not re-prompt every family cook, and a family clause must
// not re-prompt a restaurant group. OPERATOR and CONTACT_EMAIL are shared, because those are
// the same facts: one operator, one mailbox a human actually reads.
//
// Bump these alongside KITCHEN_TERMS_VERSION in src/kitchen/components/KitchenTermsGate.tsx.
export const KITCHEN_TERMS_UPDATED = "21 October 2026";
// 15 October 2026: the retention section now states what deleting your account does to the
// records your work is attached to, which migration 0059 is what makes true. Only the PRIVACY
// date moves: no acceptance is recorded against a privacy notice, so nobody needs re-asking,
// and KITCHEN_TERMS_UPDATED stays where it is.
export const KITCHEN_PRIVACY_UPDATED = "21 October 2026";
