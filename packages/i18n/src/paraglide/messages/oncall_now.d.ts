export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_NowInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_NowInputs */
/**
* | output |
* | --- |
* | "On call now" |
*
* @param {Oncall_NowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_now: ((inputs?: Oncall_NowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_NowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
