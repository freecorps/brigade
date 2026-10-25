export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Route_RingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Route_RingInputs */
/**
* | output |
* | --- |
* | "It rings as a call" |
*
* @param {Call_Route_RingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_route_ring: ((inputs?: Call_Route_RingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Route_RingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
