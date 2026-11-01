export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Instances_FullInputs = {
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ max: NonNullable<unknown> }} Mobile_Instances_FullInputs */
/**
* | output |
* | --- |
* | "This phone has the most instances it can ({max}). Remove one to add another." |
*
* @param {Mobile_Instances_FullInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_instances_full: ((inputs: Mobile_Instances_FullInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Instances_FullInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
