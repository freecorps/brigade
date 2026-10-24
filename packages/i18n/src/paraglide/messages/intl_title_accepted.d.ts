export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_Title_AcceptedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_Title_AcceptedInputs */
/**
* | output |
* | --- |
* | "Accepted" |
*
* @param {Intl_Title_AcceptedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_title_accepted: ((inputs?: Intl_Title_AcceptedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Title_AcceptedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
