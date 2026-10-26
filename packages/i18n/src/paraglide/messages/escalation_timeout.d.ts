export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_TimeoutInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Escalation_TimeoutInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Next level after {countFormatted} minute" |
* | * | "Next level after {countFormatted} minutes" |
*
* @param {Escalation_TimeoutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_timeout: ((inputs: Escalation_TimeoutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TimeoutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
