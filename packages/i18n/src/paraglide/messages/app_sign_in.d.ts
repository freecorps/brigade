export type LocalizedString = import('../runtime.js').LocalizedString;
export type App_Sign_InInputs = {
    part: NonNullable<unknown>;
    device: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, device: NonNullable<unknown>, time: NonNullable<unknown> }} App_Sign_InInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Sign in with a QR code" |
* | "description" | "Signs the Brigade app in as you, with no password typed on the phone." |
* | "start" | "Show a sign-in code" |
* | "creating" | "Making a code…" |
* | "scan" | "On the Brigade app's sign-in screen, tap \"Scan a QR code\" and point the phone at this code." |
* | "never_share" | "Never share this code, nor the number your phone shows." |
* | "expires_in" | "Expires in {time}" |
* | "waiting" | "Waiting for your phone to scan the code." |
* | "qr_label" | "QR code that signs the Brigade app in as you" |
* | "cancel" | "Cancel" |
* | "claimed_title" | "{device} wants to sign in as you" |
* | "claimed_hint" | "Type the number your phone shows. If you didn't just scan this code, deny it." |
* | "number_label" | "Number on your phone" |
* | "number_invalid" | "Type the 2 digits your phone shows." |
* | "approve" | "Sign in" |
* | "approving" | "Checking…" |
* | "deny" | "Deny" |
* | "answer_failed" | "Couldn't send your answer. Try again." |
* | "approved" | "Approved. Finishing on your phone…" |
* | "signed_in" | "{device} is signed in as you." |
* | "another" | "Sign in another phone" |
* | "denied" | "Denied. Nobody was signed in." |
* | "wrong_number" | "That number didn't match, so nobody was signed in. If it was your phone, start again." |
* | "expired" | "This code expired before a phone used it." |
* | "again" | "Show a new code" |
* | "failed" | "Couldn't make a code. Try again in a minute." |
* | "rate_limited" | "Too many codes in a minute. Wait a moment and try again." |
* | "address_title" | "Only the address" |
* | "address_description" | "Adds this Brigade to the app without signing in, for a phone that signs in another way (with its password, or your company's sign-in)." |
* | "address_label" | "QR code with this Brigade's address" |
* | * | "Sign in with a QR code" |
*
* @param {App_Sign_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const app_sign_in: ((inputs: App_Sign_InInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<App_Sign_InInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
