export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Last_ResultInputs = {
    kind: NonNullable<unknown>;
    when: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, when: NonNullable<unknown> }} Monitor_Last_ResultInputs */
/**
* | kind | output |
* | --- | --- |
* | "http" | "Checked {when}" |
* | * | "Last ping {when}" |
*
* @param {Monitor_Last_ResultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_last_result: ((inputs: Monitor_Last_ResultInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Last_ResultInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
