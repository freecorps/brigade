export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_Title_RejectedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_Title_RejectedInputs */
/**
* | output |
* | --- |
* | "Rejected" |
*
* @param {Intl_Title_RejectedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_title_rejected: ((inputs?: Intl_Title_RejectedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Title_RejectedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
