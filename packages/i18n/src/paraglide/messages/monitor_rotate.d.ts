export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_RotateInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_RotateInputs */
/**
* | part | output |
* | --- | --- |
* | "label" | "Heartbeat URL" |
* | "hint" | "Brigade keeps only a hash of it, so the current URL can't be shown again. A new one replaces it." |
* | "action" | "New URL" |
* | "prompt" | "Make a new URL for {name}?" |
* | "stops" | "The current URL stops working at once; update whatever pings it." |
* | "restart" | "The monitor starts over from Waiting, with a full interval and grace before a missed ping counts." |
* | "restart_alert" | "Its firing alert stays until the new URL is pinged." |
* | "unsaved" | "Your other changes in this form aren't saved." |
* | "confirm" | "Make new URL" |
* | "keep" | "Keep current URL" |
* | "shown" | "New URL for {name}, shown only once" |
* | * | "New URL" |
*
* @param {Monitor_RotateInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_rotate: ((inputs: Monitor_RotateInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_RotateInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
