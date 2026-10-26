export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_KindInputs = {
    kind: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown> }} Monitor_KindInputs */
/**
* | kind | output |
* | --- | --- |
* | "http" | "HTTP check" |
* | "tcp" | "TCP port" |
* | * | "Heartbeat" |
*
* @param {Monitor_KindInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_kind: ((inputs: Monitor_KindInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_KindInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
