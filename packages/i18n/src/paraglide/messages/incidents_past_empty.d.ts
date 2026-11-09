export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Past_EmptyInputs = {
    days: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ days: NonNullable<unknown> }} Incidents_Past_EmptyInputs */
/**
* | output |
* | --- |
* | "No incident was resolved or declined in the last {days} days." |
*
* @param {Incidents_Past_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_past_empty: ((inputs: Incidents_Past_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
