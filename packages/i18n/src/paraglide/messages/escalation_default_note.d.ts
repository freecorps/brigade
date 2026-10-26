export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Default_NoteInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Default_NoteInputs */
/**
* | output |
* | --- |
* | "Every page, from a monitor or declared by hand, goes through the default policy." |
*
* @param {Escalation_Default_NoteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_default_note: ((inputs?: Escalation_Default_NoteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Default_NoteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
