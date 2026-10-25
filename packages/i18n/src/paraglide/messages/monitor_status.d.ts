export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_StatusInputs = {
    status: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ status: NonNullable<unknown> }} Monitor_StatusInputs */
/**
* | status | output |
* | --- | --- |
* | "up" | "Up" |
* | "down" | "Down" |
* | "paused" | "Paused" |
* | * | "Waiting" |
*
* @param {Monitor_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_status: ((inputs: Monitor_StatusInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_StatusInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
