export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Repeat_ChoiceInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Escalation_Repeat_ChoiceInputs */
/**
* | count | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "Don't repeat" |
* | * | "one" | "{countFormatted} more time" |
* | * | * | "{countFormatted} more times" |
*
* @param {Escalation_Repeat_ChoiceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_repeat_choice: ((inputs: Escalation_Repeat_ChoiceInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Repeat_ChoiceInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
