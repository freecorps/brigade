export type LocalizedString = import('../runtime.js').LocalizedString;
export type Webhook_Events_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Webhook_Events_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} event" |
* | * | "{countFormatted} events" |
*
* @param {Webhook_Events_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const webhook_events_count: ((inputs: Webhook_Events_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_Events_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
