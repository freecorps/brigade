export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_YesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_YesInputs */
/**
* | output |
* | --- |
* | "Yes" |
*
* @param {Intl_YesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_yes: ((inputs?: Intl_YesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_YesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
