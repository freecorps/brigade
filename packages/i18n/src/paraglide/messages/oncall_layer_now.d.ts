export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_NowInputs = {
    state: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ state: NonNullable<unknown>, name: NonNullable<unknown> }} Oncall_Layer_NowInputs */
/**
* | state | output |
* | --- | --- |
* | "active" | "Now: {name}" |
* | "hidden" | "Now: {name}, hidden by a later layer" |
* | "overridden" | "Now: {name}, covered by an override" |
* | * | "Starts {name}" |
*
* @param {Oncall_Layer_NowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_now: ((inputs: Oncall_Layer_NowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
