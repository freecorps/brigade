export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Heartbeat_ReadyInputs = {
    interval: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ interval: NonNullable<unknown> }} Monitor_Heartbeat_ReadyInputs */
/**
* | output |
* | --- |
* | "Send a POST to this URL at least every {interval}. It is shown only now: copy it before you close this." |
*
* @param {Monitor_Heartbeat_ReadyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_heartbeat_ready: ((inputs: Monitor_Heartbeat_ReadyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Heartbeat_ReadyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
