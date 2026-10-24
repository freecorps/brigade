export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Round_TripInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Round_TripInputs */
/**
* | output |
* | --- |
* | "Round trip" |
*
* @param {Stack_Round_TripInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_round_trip: ((inputs?: Stack_Round_TripInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Round_TripInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
