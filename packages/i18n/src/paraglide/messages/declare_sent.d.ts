export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_SentInputs = {
    title: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ title: NonNullable<unknown> }} Declare_SentInputs */
/**
* | output |
* | --- |
* | "Sent “{title}”. It shows here once the list loads." |
*
* @param {Declare_SentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_sent: ((inputs: Declare_SentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_SentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
