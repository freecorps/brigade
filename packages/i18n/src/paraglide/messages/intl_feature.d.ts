export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_FeatureInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_FeatureInputs */
/**
* | output |
* | --- |
* | "Feature" |
*
* @param {Intl_FeatureInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_feature: ((inputs?: Intl_FeatureInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_FeatureInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
