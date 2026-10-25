export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Heartbeat_EveryInputs = {
    interval: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ interval: NonNullable<unknown> }} Monitor_Heartbeat_EveryInputs */
/**
* | output |
* | --- |
* | "Expects a ping every {interval}" |
*
* @param {Monitor_Heartbeat_EveryInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_heartbeat_every: ((inputs: Monitor_Heartbeat_EveryInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Heartbeat_EveryInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
