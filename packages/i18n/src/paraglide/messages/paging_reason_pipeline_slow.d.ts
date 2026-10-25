export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Pipeline_SlowInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Pipeline_SlowInputs */
/**
* | output |
* | --- |
* | "Test pages take more than two minutes to get through the event queue." |
*
* @param {Paging_Reason_Pipeline_SlowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_pipeline_slow: ((inputs?: Paging_Reason_Pipeline_SlowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Pipeline_SlowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
