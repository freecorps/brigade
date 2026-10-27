export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Signup_AttemptInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_Signup_AttemptInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "Someone tried to sign up with your email" |
* | "intro" | "Someone tried to create a Brigade account with {email}, which already has one. Nothing changed: no account was created and your password is the same." |
* | "open" | "Sign in to Brigade" |
* | "reset" | "If it was you, sign in instead. Forgot your password? Choose a new one from \"Forgot your password?\" on the sign-in page." |
* | "footer" | "If it wasn't you, ignore this email." |
* | * | "Brigade" |
*
* @param {Email_Signup_AttemptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_signup_attempt: ((inputs: Email_Signup_AttemptInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Signup_AttemptInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
