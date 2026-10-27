export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Webhook_DisabledInputs = {
    part: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    webhook: NonNullable<unknown>;
    failures: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, webhook: NonNullable<unknown>, failures: NonNullable<unknown> }} Email_Webhook_DisabledInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "A webhook in {workspace} was turned off" |
* | "intro" | "Brigade turned off the webhook {webhook} in {workspace}: its last {failures} deliveries failed, over more than a day." |
* | "how" | "Fix the endpoint, then turn it back on from the Webhooks card on the dashboard. Events from while it was off aren't sent." |
* | "open" | "Open the dashboard" |
* | "footer" | "You get this email because you're an owner of {workspace} on Brigade." |
* | * | "A webhook in {workspace} was turned off" |
*
* @param {Email_Webhook_DisabledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_webhook_disabled: ((inputs: Email_Webhook_DisabledInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Webhook_DisabledInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
