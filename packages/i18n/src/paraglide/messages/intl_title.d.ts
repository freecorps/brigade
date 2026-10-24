export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_TitleInputs */
/**
* | output |
* | --- |
* | "Intl support" |
*
* @param {Intl_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_title: ((inputs?: Intl_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
