export type LocalizedString = import('../runtime.js').LocalizedString;
export type Webhook_ErrorInputs = {
    error: NonNullable<unknown>;
    status: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ error: NonNullable<unknown>, status: NonNullable<unknown> }} Webhook_ErrorInputs */
/**
* | error | output |
* | --- | --- |
* | "timeout" | "Timed out" |
* | "network" | "Couldn't connect" |
* | "status" | "HTTP {status}" |
* | "redirect" | "Redirect {status}, not followed" |
* | "blocked" | "Blocked: not a public https URL" |
* | "secret" | "Secret unreadable on the server" |
* | * | "Timed out" |
*
* @param {Webhook_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const webhook_error: ((inputs: Webhook_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
