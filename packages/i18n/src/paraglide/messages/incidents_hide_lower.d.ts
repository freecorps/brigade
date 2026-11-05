export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Hide_LowerInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_Hide_LowerInputs */
/**
* | output |
* | --- |
* | "Hide lower-severity incidents" |
*
* @param {Incidents_Hide_LowerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_hide_lower: ((inputs?: Incidents_Hide_LowerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Hide_LowerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
