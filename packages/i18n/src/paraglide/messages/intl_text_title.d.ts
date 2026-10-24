export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_Text_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_Text_TitleInputs */
/**
* | output |
* | --- |
* | "Text validation" |
*
* @param {Intl_Text_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_text_title: ((inputs?: Intl_Text_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Text_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
