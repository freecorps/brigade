export type LocalizedString = import('../runtime.js').LocalizedString;
export type Legend_StatusInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Legend_StatusInputs */
/**
* | output |
* | --- |
* | "Status" |
*
* @param {Legend_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const legend_status: ((inputs?: Legend_StatusInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_StatusInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
