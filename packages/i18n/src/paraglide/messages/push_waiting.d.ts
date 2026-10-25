export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_WaitingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_WaitingInputs */
/**
* | output |
* | --- |
* | "Waiting…" |
*
* @param {Push_WaitingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_waiting: ((inputs?: Push_WaitingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_WaitingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
