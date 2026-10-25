export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitors_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitors_EmptyInputs */
/**
* | output |
* | --- |
* | "Nothing is watched yet. Add an HTTP check, or a heartbeat for jobs that should check in." |
*
* @param {Monitors_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitors_empty: ((inputs?: Monitors_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
