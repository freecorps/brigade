export type LocalizedString = import('../runtime.js').LocalizedString;
export type Webhook_Headers_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Webhook_Headers_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} custom header" |
* | * | "{countFormatted} custom headers" |
*
* @param {Webhook_Headers_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const webhook_headers_count: ((inputs: Webhook_Headers_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_Headers_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
