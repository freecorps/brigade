export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Script_PromptInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Script_PromptInputs */
/**
* | output |
* | --- |
* | "Press 1 to acknowledge, or hang up to pass the page on." |
*
* @param {Call_Script_PromptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_script_prompt: ((inputs?: Call_Script_PromptInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Script_PromptInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
