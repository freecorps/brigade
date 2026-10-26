export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Add_Target_PlaceholderInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Add_Target_PlaceholderInputs */
/**
* | output |
* | --- |
* | "Choose…" |
*
* @param {Escalation_Add_Target_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_add_target_placeholder: ((inputs?: Escalation_Add_Target_PlaceholderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Add_Target_PlaceholderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
