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
export const PRIVACY_UPDATED = "1 October 2026";
export const COOKIES_UPDATED = "1 October 2026";
export const TERMS_UPDATED = "1 October 2026";
