export type LocalizedString = import('../runtime.js').LocalizedString;
export type Reset_PageInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Reset_PageInputs */
/**
* | part | output |
* | --- | --- |
* | "forgot_link" | "Forgot your password?" |
* | "forgot_page_title" | "Forgot password" |
* | "forgot_title" | "Reset your password" |
* | "forgot_description" | "Enter the email you signed up with. We'll send you a link to choose a new password." |
* | "send" | "Send the link" |
* | "sending" | "Sending…" |
* | "sent_title" | "Check your email" |
* | "sent_body" | "If {email} has a Brigade account, a link to choose a new password is on its way. It works for 1 hour. Check spam too." |
* | "other_address" | "Use another address" |
* | "rate_limited" | "Too many links asked for this address. Try again in an hour." |
* | "not_configured" | "This Brigade server can't send email yet. Ask whoever runs it." |
* | "failed" | "Couldn't send the link. Try again." |
* | "back" | "Back to sign in" |
* | "reset_page_title" | "New password" |
* | "reset_title" | "Choose a new password" |
* | "reset_description" | "Saving it signs your account out everywhere, including the app on your phone." |
* | "new_password_label" | "New password" |
* | "save" | "Save new password" |
* | "saving" | "Saving…" |
* | "done_title" | "Password changed" |
* | "done_body" | "Sign in with your new password. Every session was signed out, and your email address is confirmed." |
* | "sign_in" | "Sign in" |
* | "invalid_title" | "This link doesn't work" |
* | "invalid_body" | "It may have expired (links work for 1 hour), been used already, or been cut off. Ask for a new one." |
* | "request_new" | "Send a new link" |
* | "uncertain" | "Brigade hit an error after receiving your new password, so it may already be saved. Try signing in with it; if that doesn't work, ask for a new link." |
* | * | "Reset your password" |
*
* @param {Reset_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const reset_page: ((inputs: Reset_PageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Reset_PageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
