export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_RenameInputs = {
    part: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_RenameInputs */
/**
* | part | output |
* | --- | --- |
* | "action" | "Rename" |
* | "label" | "Incident title" |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "invalid" | "Give it a title with visible characters." |
* | "failed" | "Couldn't rename it. {reason}" |
* | * | "Rename" |
*
* @param {Incident_RenameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_rename: ((inputs: Incident_RenameInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_RenameInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
