export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_DiscardInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_DiscardInputs */
/**
* | part | output |
* | --- | --- |
* | "prompt" | "Discard your changes to {name}?" |
* | "prompt_new" | "Discard this new monitor?" |
* | "discard" | "Discard changes" |
* | * | "Keep editing" |
*
* @param {Monitor_DiscardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_discard: ((inputs: Monitor_DiscardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_DiscardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
