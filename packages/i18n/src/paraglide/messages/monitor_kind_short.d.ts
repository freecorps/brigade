export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Kind_ShortInputs = {
    kind: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown> }} Monitor_Kind_ShortInputs */
/**
* | kind | output |
* | --- | --- |
* | "http" | "HTTP" |
* | "tcp" | "TCP" |
* | * | "Heartbeat" |
*
* @param {Monitor_Kind_ShortInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_kind_short: ((inputs: Monitor_Kind_ShortInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Kind_ShortInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
