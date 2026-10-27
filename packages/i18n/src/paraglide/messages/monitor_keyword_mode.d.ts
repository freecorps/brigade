export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Keyword_ModeInputs = {
    mode: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ mode: NonNullable<unknown> }} Monitor_Keyword_ModeInputs */
/**
* | mode | output |
* | --- | --- |
* | "regex" | "Pattern" |
* | * | "Text" |
*
* @param {Monitor_Keyword_ModeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_keyword_mode: ((inputs: Monitor_Keyword_ModeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Keyword_ModeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
