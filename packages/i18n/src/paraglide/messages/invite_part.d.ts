export type LocalizedString = import('../runtime.js').LocalizedString;
export type Invite_PartInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
    date: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown>, date: NonNullable<unknown>, name: NonNullable<unknown> }} Invite_PartInputs */
/**
* | part | output |
* | --- | --- |
* | "open" | "Invite" |
* | "title" | "Invite someone" |
* | "hint" | "They get an email with a link that works for 7 days. Only that address can accept it." |
* | "email_label" | "Email" |
* | "role_label" | "Role" |
* | "submit" | "Send invitation" |
* | "sending" | "Sending…" |
* | "cancel" | "Cancel" |
* | "sent" | "Invitation sent to {email}." |
* | "unverified" | "Confirm your own email before you invite people." |
* | "pending_title" | "Pending invitations" |
* | "expires" | "Expires {date}" |
* | "expired" | "Expired: resend it to give it 7 more days" |
* | "invited_by" | "Invited by {name}" |
* | "resend" | "Resend" |
* | "resent" | "Sent again to {email}." |
* | "revoke" | "Revoke" |
* | "revoke_prompt" | "Revoke the invitation to {email}? Its link stops working." |
* | "revoked" | "Invitation to {email} revoked." |
* | "load_failed" | "Couldn't load the pending invitations." |
* | * | "Invite" |
*
* @param {Invite_PartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const invite_part: ((inputs: Invite_PartInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Invite_PartInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
