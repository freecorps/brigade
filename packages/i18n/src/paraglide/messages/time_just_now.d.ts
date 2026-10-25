export type LocalizedString = import('../runtime.js').LocalizedString;
export type Time_Just_NowInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Time_Just_NowInputs */
/**
* | output |
* | --- |
* | "just now" |
*
* @param {Time_Just_NowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const time_just_now: ((inputs?: Time_Just_NowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Time_Just_NowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
