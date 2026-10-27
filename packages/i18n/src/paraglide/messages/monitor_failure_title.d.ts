export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Failure_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Failure_TitleInputs */
/**
* | output |
* | --- |
* | "When it fails" |
*
* @param {Monitor_Failure_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_failure_title: ((inputs?: Monitor_Failure_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Failure_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
