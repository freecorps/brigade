export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Title_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Title_LabelInputs */
/**
* | output |
* | --- |
* | "Title" |
*
* @param {Declare_Title_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_title_label: ((inputs?: Declare_Title_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
