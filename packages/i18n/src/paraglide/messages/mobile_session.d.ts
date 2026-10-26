export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_SessionInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Mobile_SessionInputs */
/**
* | part | output |
* | --- | --- |
* | "sign_in_hint" | "New to Brigade? Create an account on the dashboard, then sign in here." |
* | "no_server" | "This build doesn't say which Brigade to connect to." |
* | "account" | "Account" |
* | "no_workspace" | "Your account isn't in a workspace yet. Create one on the dashboard, then open Brigade again." |
* | "sign_out_title" | "Sign out of Brigade?" |
* | "sign_out_body" | "This phone stops getting pages until you sign in again." |
* | "cancel" | "Cancel" |
* | "signing_out" | "Signing out…" |
* | "pages" | "Pages on this phone" |
* | "pages_pending" | "Setting up…" |
* | "pages_on" | "On" |
* | "pages_off" | "Notifications are off. Turn them on in Settings to be paged here." |
* | "pages_unsupported" | "Not on this phone yet" |
* | "pages_failed" | "Couldn't register this phone. Brigade tries again the next time it opens." |
* | "pages_taken" | "This phone still pages the person signed in on it before you, who signed out without a connection. Brigade frees it for you once it can finish their sign-out." |
* | "open_hint" | "Opens the incident" |
* | "assign_hint" | "Opens the members who can hold it" |
* | "pages_notice_title" | "This phone isn't paging you" |
* | "open_settings" | "Open Settings" |
* | "sign_out_body_unpaged" | "You'll need to sign in again to see incidents here." |
* | "sign_out_kept_title" | "This phone may still get pages for you" |
* | "sign_out_kept_body" | "Brigade couldn't reach the server, so this phone keeps getting your pages until it's back online. Brigade finishes signing you out then, on its own." |
* | "update_sending" | "Sending…" |
* | "update_waiting" | "Waiting for a connection" |
* | "show_password" | "Show password" |
* | "hide_password" | "Hide password" |
* | * | "Brigade" |
*
* @param {Mobile_SessionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_session: ((inputs: Mobile_SessionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_SessionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
