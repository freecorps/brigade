export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Expected_Status_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Expected_Status_HintInputs */
/**
* | output |
* | --- |
* | "Empty: any 2xx or 3xx. Redirects are not followed." |
*
* @param {Monitor_Expected_Status_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_expected_status_hint: ((inputs?: Monitor_Expected_Status_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Expected_Status_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
