export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_InviteInputs = {
    part: NonNullable<unknown>;
    inviter: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    role: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, inviter: NonNullable<unknown>, workspace: NonNullable<unknown>, role: NonNullable<unknown> }} Email_InviteInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "{inviter} invited you to {workspace} on Brigade" |
* | "intro" | "{inviter} invited you to join {workspace} on Brigade, where the team responds to incidents, as {role}." |
* | "how" | "To accept, sign in or create a Brigade account with this email address, and confirm it." |
* | "open" | "See the invitation" |
* | "expires" | "The invitation expires in 7 days." |
* | "footer" | "If you weren't expecting this, ignore this email: nobody joins without accepting." |
* | * | "Brigade" |
*
* @param {Email_InviteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_invite: ((inputs: Email_InviteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_InviteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
