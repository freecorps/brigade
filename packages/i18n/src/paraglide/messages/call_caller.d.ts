export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_CallerInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_CallerInputs */
/**
* | output |
* | --- |
* | "Brigade on-call" |
*
* @param {Call_CallerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_caller: ((inputs?: Call_CallerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_CallerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
