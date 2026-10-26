export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_No_BeatInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_No_BeatInputs */
/**
* | output |
* | --- |
* | "The minute self-check stopped running." |
*
* @param {Paging_Reason_No_BeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_no_beat: ((inputs?: Paging_Reason_No_BeatInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_No_BeatInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
