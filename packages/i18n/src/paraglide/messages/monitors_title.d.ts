export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitors_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitors_TitleInputs */
/**
* | output |
* | --- |
* | "Monitors" |
*
* @param {Monitors_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitors_title: ((inputs?: Monitors_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
