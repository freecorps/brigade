export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_RepeatInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Escalation_RepeatInputs */
/**
* | count | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "Doesn't repeat" |
* | * | "one" | "Repeats {countFormatted} more time" |
* | * | * | "Repeats {countFormatted} more times" |
*
* @param {Escalation_RepeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_repeat: ((inputs: Escalation_RepeatInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_RepeatInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
