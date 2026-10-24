export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_Engine_OtherInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_Engine_OtherInputs */
/**
* | output |
* | --- |
* | "another engine" |
*
* @param {Intl_Engine_OtherInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_engine_other: ((inputs?: Intl_Engine_OtherInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Engine_OtherInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
