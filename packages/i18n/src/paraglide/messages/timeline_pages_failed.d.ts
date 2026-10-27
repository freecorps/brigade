export type LocalizedString = import('../runtime.js').LocalizedString;
export type Timeline_Pages_FailedInputs = {
    reason: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, count: NonNullable<unknown> }} Timeline_Pages_FailedInputs */
/**
* | reason | countPlural | output |
* | --- | --- | --- |
* | "no_devices" | "one" | "Couldn't page {countFormatted} person: no registered device" |
* | "no_devices" | * | "Couldn't page {countFormatted} people: no registered device" |
* | "undelivered" | "one" | "Couldn't page {countFormatted} person: the push didn't go through" |
* | "undelivered" | * | "Couldn't page {countFormatted} people: the push didn't go through" |
* | "token_invalid" | "one" | "Couldn't page {countFormatted} person: Apple refused their phone's token, so it was removed" |
* | "token_invalid" | * | "Couldn't page {countFormatted} people: Apple refused their phones' tokens, so they were removed" |
* | "unsupported" | "one" | "Couldn't page {countFormatted} person: Brigade can't push to Android phones yet" |
* | "unsupported" | * | "Couldn't page {countFormatted} people: Brigade can't push to Android phones yet" |
* | "not_configured" | "one" | "Couldn't page {countFormatted} person: push notifications aren't set up on this server" |
* | "not_configured" | * | "Couldn't page {countFormatted} people: push notifications aren't set up on this server" |
* | "over_limit" | "one" | "Couldn't page {countFormatted} person: this page went to too many phones" |
* | "over_limit" | * | "Couldn't page {countFormatted} people: this page went to too many phones" |
* | "not_a_member" | "one" | "Couldn't page {countFormatted} person: no longer someone who can respond" |
* | "not_a_member" | * | "Couldn't page {countFormatted} people: no longer someone who can respond" |
* | * | "one" | "Couldn't page {countFormatted} person" |
* | * | * | "Couldn't page {countFormatted} people" |
*
* @param {Timeline_Pages_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const timeline_pages_failed: ((inputs: Timeline_Pages_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Timeline_Pages_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
