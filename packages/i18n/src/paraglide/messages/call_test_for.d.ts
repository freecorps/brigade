export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Test_ForInputs = {
    incident: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ incident: NonNullable<unknown> }} Call_Test_ForInputs */
/**
* | output |
* | --- |
* | "For {incident}" |
*
* @param {Call_Test_ForInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_test_for: ((inputs: Call_Test_ForInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_ForInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
