export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_TextInputs = {
    text: NonNullable<unknown>;
    name: NonNullable<unknown>;
    max: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, max: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_TextInputs */
/**
* | text | output |
* | --- | --- |
* | "your_time" | "{time} your time" |
* | "members_max" | "Up to {max} people per layer." |
* | "choose_person" | "Choose a person…" |
* | "remove_override" | "Remove {name}'s override?" |
* | * | "A later layer has someone at all times from this layer's start, so nobody in this one is ever on call." |
*
* @param {Oncall_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_text: ((inputs: Oncall_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
