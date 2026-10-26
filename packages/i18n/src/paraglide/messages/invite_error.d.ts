export type LocalizedString = import('../runtime.js').LocalizedString;
export type Invite_ErrorInputs = {
    reason: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, email: NonNullable<unknown> }} Invite_ErrorInputs */
/**
* | reason | output |
* | --- | --- |
* | "forbidden" | "You can't make this change." |
* | "already_member" | "{email} is already a member." |
* | "already_invited" | "{email} already has a pending invitation. Resend it from the list." |
* | "limit_reached" | "This workspace has too many pending invitations. Revoke some first." |
* | "rate_limited" | "This workspace sent too many invitations today. Try again tomorrow." |
* | "too_soon" | "This invitation went out a few minutes ago. Wait a little before sending it again." |
* | "not_found" | "This invitation is no longer pending." |
* | "unverified" | "Confirm your own email before you invite people." |
* | "invalid_email" | "Enter an email address like name@example.com." |
* | "not_applied" | "Saved. The email goes out within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't confirm the change; check the list." |
* | * | "Something went wrong. Try again." |
*
* @param {Invite_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const invite_error: ((inputs: Invite_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Invite_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
