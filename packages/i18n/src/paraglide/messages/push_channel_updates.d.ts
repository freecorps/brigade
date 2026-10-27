export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Channel_UpdatesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Channel_UpdatesInputs */
/**
* | output |
* | --- |
* | "Incident updates" |
*
* @param {Push_Channel_UpdatesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_channel_updates: ((inputs?: Push_Channel_UpdatesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Channel_UpdatesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
