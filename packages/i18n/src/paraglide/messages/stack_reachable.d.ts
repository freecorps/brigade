export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_ReachableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_ReachableInputs */
/**
* | output |
* | --- |
* | "Reachable" |
*
* @param {Stack_ReachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_reachable: ((inputs?: Stack_ReachableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_ReachableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
