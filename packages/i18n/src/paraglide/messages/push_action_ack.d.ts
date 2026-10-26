export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Action_AckInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Action_AckInputs */
/**
* | output |
* | --- |
* | "Acknowledge" |
*
* @param {Push_Action_AckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_action_ack: ((inputs?: Push_Action_AckInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Action_AckInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
