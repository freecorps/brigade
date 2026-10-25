export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_HeartbeatInputs = {
    part: NonNullable<unknown>;
    interval: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, interval: NonNullable<unknown> }} Monitor_HeartbeatInputs */
/**
* | part | output |
* | --- | --- |
* | "once" | "Shown only once" |
* | "send" | "Send a POST to this URL at least every {interval}. Brigade keeps only a hash of it, so it can't be shown again." |
* | "try" | "Try it from a terminal:" |
* | "copy" | "Copy URL" |
* | "copied" | "Copied" |
* | "close_prompt" | "Close without copying? The URL can't be shown again." |
* | "close" | "Close anyway" |
* | * | "Keep it open" |
*
* @param {Monitor_HeartbeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_heartbeat: ((inputs: Monitor_HeartbeatInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_HeartbeatInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
