export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Nobody_ReachedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Nobody_ReachedInputs */
/**
* | output |
* | --- |
* | "Nobody reached" |
*
* @param {Escalation_Nobody_ReachedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_nobody_reached: ((inputs?: Escalation_Nobody_ReachedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Nobody_ReachedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
