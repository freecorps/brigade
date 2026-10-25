export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Channel_PagesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Channel_PagesInputs */
/**
* | output |
* | --- |
* | "Pages" |
*
* @param {Call_Channel_PagesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_channel_pages: ((inputs?: Call_Channel_PagesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Channel_PagesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
