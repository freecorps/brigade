export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_HeadingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_HeadingInputs */
/**
* | output |
* | --- |
* | "Declare an incident" |
*
* @param {Declare_HeadingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_heading: ((inputs?: Declare_HeadingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_HeadingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
