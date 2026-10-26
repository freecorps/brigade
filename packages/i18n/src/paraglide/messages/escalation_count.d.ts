export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_CountInputs = {
    kind: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown> }} Escalation_CountInputs */
/**
* | kind | count | countPlural | output |
* | --- | --- | --- | --- |
* | "policies" | * | "one" | "{countFormatted} policy" |
* | "policies" | * | * | "{countFormatted} policies" |
* | "timeout" | * | "one" | "Next level after {countFormatted} minute" |
* | "timeout" | * | * | "Next level after {countFormatted} minutes" |
* | "repeat" | "0" | * | "Doesn't repeat" |
* | "repeat" | * | "one" | "Repeats {countFormatted} more time" |
* | "repeat" | * | * | "Repeats {countFormatted} more times" |
* | "repeat_choice" | "0" | * | "Don't repeat" |
* | "repeat_choice" | * | "one" | "{countFormatted} more time" |
* | "repeat_choice" | * | * | "{countFormatted} more times" |
* | "timeout_repeat" | * | "one" | "Level 1 again after {countFormatted} minute" |
* | "timeout_repeat" | * | * | "Level 1 again after {countFormatted} minutes" |
* | "timeout_end" | * | "one" | "Everyone who can respond after {countFormatted} minute" |
* | "timeout_end" | * | * | "Everyone who can respond after {countFormatted} minutes" |
* | "earlier" | * | * | "Earlier levels ({countFormatted})" |
* | "show_levels" | * | * | "Show all {countFormatted} levels" |
* | "more_missed" | * | * | "and {countFormatted} more" |
* | * | * | * | "{countFormatted}" |
*
* @param {Escalation_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_count: ((inputs: Escalation_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
