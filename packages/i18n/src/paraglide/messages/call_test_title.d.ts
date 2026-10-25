export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Test_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Test_TitleInputs */
/**
* | output |
* | --- |
* | "Call screen" |
*
* @param {Call_Test_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_test_title: ((inputs?: Call_Test_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
