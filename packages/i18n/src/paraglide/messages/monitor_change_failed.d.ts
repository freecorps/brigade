export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Change_FailedInputs = {
    name: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown>, reason: NonNullable<unknown> }} Monitor_Change_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't change {name}: {reason}" |
*
* @param {Monitor_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_change_failed: ((inputs: Monitor_Change_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Change_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
