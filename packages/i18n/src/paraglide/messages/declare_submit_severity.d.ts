export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Submit_SeverityInputs = {
    severity: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ severity: NonNullable<unknown> }} Declare_Submit_SeverityInputs */
/**
* | output |
* | --- |
* | "Declare {severity}" |
*
* @param {Declare_Submit_SeverityInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_submit_severity: ((inputs: Declare_Submit_SeverityInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Submit_SeverityInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
