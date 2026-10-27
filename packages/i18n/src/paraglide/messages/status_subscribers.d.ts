export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_SubscribersInputs = {
    part: NonNullable<unknown>;
    confirmed: NonNullable<unknown>;
    pending: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, confirmed: NonNullable<unknown>, pending: NonNullable<unknown>, email: NonNullable<unknown> }} Status_SubscribersInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Email subscribers" |
* | "hint" | "Visitors subscribe on the public page and confirm by email. Only owners and admins see this, and addresses never appear on the page." |
* | "count" | "{confirmed} confirmed, {pending} waiting to confirm" |
* | "load_failed" | "Couldn't load the subscribers." |
* | "retry" | "Try again" |
* | "export" | "Export CSV" |
* | "remove_label" | "Remove a subscriber" |
* | "remove_hint" | "Their address. They get no email about it." |
* | "remove" | "Remove" |
* | "removing" | "Removing…" |
* | "removed" | "Removed {email}." |
* | "not_found" | "No subscriber has that address." |
* | "remove_failed" | "Couldn't remove. Try again." |
* | * | "Subscribers" |
*
* @param {Status_SubscribersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_subscribers: ((inputs: Status_SubscribersInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_SubscribersInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
