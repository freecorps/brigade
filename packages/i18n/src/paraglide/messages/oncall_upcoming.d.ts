export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_UpcomingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_UpcomingInputs */
/**
* | output |
* | --- |
* | "Next handoffs" |
*
* @param {Oncall_UpcomingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_upcoming: ((inputs?: Oncall_UpcomingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UpcomingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
