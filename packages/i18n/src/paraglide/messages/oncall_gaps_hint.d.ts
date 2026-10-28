export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Gaps_HintInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Oncall_Gaps_HintInputs */
/**
* | part | output |
* | --- | --- |
* | "manage" | "An empty layer has nobody on call unless another layer covers it. Edit the schedule to add someone, or remove the layer." |
* | * | "An empty layer has nobody on call unless another layer covers it. Ask an owner or admin to add someone." |
*
* @param {Oncall_Gaps_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_gaps_hint: ((inputs: Oncall_Gaps_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
