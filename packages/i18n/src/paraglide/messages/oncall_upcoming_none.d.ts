export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Upcoming_NoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Upcoming_NoneInputs */
/**
* | output |
* | --- |
* | "No handoffs in the next 4 weeks" |
*
* @param {Oncall_Upcoming_NoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_upcoming_none: ((inputs?: Oncall_Upcoming_NoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Upcoming_NoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
