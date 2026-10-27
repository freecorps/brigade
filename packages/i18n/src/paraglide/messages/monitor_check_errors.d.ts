export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Check_ErrorsInputs = {
    monitors: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ monitors: NonNullable<unknown> }} Monitor_Check_ErrorsInputs */
/**
* | output |
* | --- |
* | "Brigade couldn't judge the latest checks of {monitors}: the body pattern took too long. They keep their last result and nobody is paged for it. Simplify the ..." |
*
* @param {Monitor_Check_ErrorsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_check_errors: ((inputs: Monitor_Check_ErrorsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Check_ErrorsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
