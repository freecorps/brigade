export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_RouteInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_RouteInputs */
/**
* | output |
* | --- |
* | "When a page arrives" |
*
* @param {Call_RouteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_route: ((inputs?: Call_RouteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_RouteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
