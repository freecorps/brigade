export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Policy_UsualInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Policy_UsualInputs */
/**
* | output |
* | --- |
* | "Usual (type, service or default)" |
*
* @param {Declare_Policy_UsualInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_policy_usual: ((inputs?: Declare_Policy_UsualInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Policy_UsualInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
