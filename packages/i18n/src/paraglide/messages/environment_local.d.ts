export type LocalizedString = import('../runtime.js').LocalizedString;
export type Environment_LocalInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Environment_LocalInputs */
/**
* | output |
* | --- |
* | "Local" |
*
* @param {Environment_LocalInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const environment_local: ((inputs?: Environment_LocalInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Environment_LocalInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
