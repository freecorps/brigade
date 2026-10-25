export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Pause_ActionInputs = {
    action: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown> }} Monitor_Pause_ActionInputs */
/**
* | action | output |
* | --- | --- |
* | "pause" | "Pause" |
* | * | "Resume" |
*
* @param {Monitor_Pause_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_pause_action: ((inputs: Monitor_Pause_ActionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Pause_ActionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
