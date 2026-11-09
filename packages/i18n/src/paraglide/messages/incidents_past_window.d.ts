export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Past_WindowInputs = {
    days: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ days: NonNullable<unknown> }} Incidents_Past_WindowInputs */
/**
* | output |
* | --- |
* | "Resolved or declined, declared in the last {days} days" |
*
* @param {Incidents_Past_WindowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_past_window: ((inputs: Incidents_Past_WindowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_WindowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
