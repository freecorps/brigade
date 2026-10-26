export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Pipeline_StalledInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Pipeline_StalledInputs */
/**
* | output |
* | --- |
* | "The self-check's heartbeat stopped getting through the event queue, or gets through minutes late." |
*
* @param {Paging_Reason_Pipeline_StalledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_pipeline_stalled: ((inputs?: Paging_Reason_Pipeline_StalledInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Pipeline_StalledInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
