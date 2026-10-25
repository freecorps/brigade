export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Test_RingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Test_RingInputs */
/**
* | output |
* | --- |
* | "Ring in 10 seconds" |
*
* @param {Call_Test_RingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_test_ring: ((inputs?: Call_Test_RingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_RingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
