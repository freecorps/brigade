export type LocalizedString = import('../runtime.js').LocalizedString;
export type Severity_NamedInputs = {
    code: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ code: NonNullable<unknown>, name: NonNullable<unknown> }} Severity_NamedInputs */
/**
* | output |
* | --- |
* | "{code} {name}" |
*
* @param {Severity_NamedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const severity_named: ((inputs: Severity_NamedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_NamedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
