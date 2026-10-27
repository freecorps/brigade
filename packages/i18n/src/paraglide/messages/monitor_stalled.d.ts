export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_StalledInputs = {
    regions: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ regions: NonNullable<unknown> }} Monitor_StalledInputs */
/**
* | output |
* | --- |
* | "Checks from {regions} stopped reporting. Monitors there show No data until they report again, and nobody is paged for it." |
*
* @param {Monitor_StalledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_stalled: ((inputs: Monitor_StalledInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_StalledInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
