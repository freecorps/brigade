export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Route_BlockedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Route_BlockedInputs */
/**
* | output |
* | --- |
* | "Nothing: notifications are off" |
*
* @param {Call_Route_BlockedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_route_blocked: ((inputs?: Call_Route_BlockedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Route_BlockedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
