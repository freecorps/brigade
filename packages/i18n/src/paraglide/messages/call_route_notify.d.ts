export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Route_NotifyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Route_NotifyInputs */
/**
* | output |
* | --- |
* | "A page notification (no call screen)" |
*
* @param {Call_Route_NotifyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_route_notify: ((inputs?: Call_Route_NotifyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Route_NotifyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
