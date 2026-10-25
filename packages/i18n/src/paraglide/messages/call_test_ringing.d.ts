export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Test_RingingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Test_RingingInputs */
/**
* | output |
* | --- |
* | "Lock the phone now: it rings in 10 seconds." |
*
* @param {Call_Test_RingingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_test_ringing: ((inputs?: Call_Test_RingingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_RingingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
