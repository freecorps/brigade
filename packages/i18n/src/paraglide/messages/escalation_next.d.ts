export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_NextInputs = {
    kind: NonNullable<unknown>;
    level: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, level: NonNullable<unknown>, time: NonNullable<unknown> }} Escalation_NextInputs */
/**
* | kind | output |
* | --- | --- |
* | "level" | "Level {level} {time}" |
* | "repeat" | "Level 1 again {time}" |
* | "end" | "Gives up {time}" |
* | * | "{time}" |
*
* @param {Escalation_NextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_next: ((inputs: Escalation_NextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_NextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
