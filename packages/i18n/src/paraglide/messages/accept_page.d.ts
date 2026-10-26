export type LocalizedString = import('../runtime.js').LocalizedString;
export type Accept_PageInputs = {
    part: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    inviter: NonNullable<unknown>;
    role: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, inviter: NonNullable<unknown>, role: NonNullable<unknown>, email: NonNullable<unknown> }} Accept_PageInputs */
/**
* | part | output |
* | --- | --- |
* | "page_title" | "Invitation" |
* | "title" | "Join {workspace}" |
* | "body" | "{inviter} invited you to join {workspace} on Brigade as {role}." |
* | "body_anonymous" | "You're invited to join {workspace} on Brigade as {role}." |
* | "accept" | "Accept and join" |
* | "accepting" | "Joining…" |
* | "decline" | "Decline" |
* | "declining" | "Declining…" |
* | "declined_title" | "Invitation declined" |
* | "declined_body" | "You won't join {workspace}. Whoever invited you can send a new invitation." |
* | "sign_in_title" | "Sign in to see this invitation" |
* | "sign_in_body" | "Sign in, or create an account, with the email address the invitation was sent to." |
* | "sign_in" | "Sign in" |
* | "sign_up" | "Create an account" |
* | "wrong_email_title" | "This invitation is for another email address" |
* | "wrong_email_body" | "You're signed in as {email}. Sign out, then sign in with the address the invitation was sent to." |
* | "sign_out" | "Sign out" |
* | "unverified_title" | "Confirm your email to accept" |
* | "unverified_body" | "We sent a link to {email}. Open it, and you'll come back here." |
* | "expired_title" | "This invitation has expired" |
* | "expired_body" | "Ask whoever invited you to send it again." |
* | "gone_title" | "This invitation is no longer available" |
* | "gone_body" | "It was already accepted, declined or revoked." |
* | "not_found_title" | "Invitation not found" |
* | "not_found_body" | "Check that you opened the whole link from the email." |
* | "member_title" | "You're already in {workspace}" |
* | "open" | "Open the dashboard" |
* | "decline_prompt" | "Decline the invitation to {workspace}? To join later, you'd need a new invitation." |
* | "decline_confirm" | "Decline invitation" |
* | "cancel" | "Cancel" |
* | "expired_body_named" | "Ask {inviter} to send it again." |
* | "unverified_notice_title" | "Confirm your email to accept" |
* | * | "Invitation" |
*
* @param {Accept_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const accept_page: ((inputs: Accept_PageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Accept_PageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
