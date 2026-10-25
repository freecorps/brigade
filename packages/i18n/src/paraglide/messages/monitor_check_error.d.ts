export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Check_ErrorInputs = {
    reason: NonNullable<unknown>;
    got: NonNullable<unknown>;
    expected: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, got: NonNullable<unknown>, expected: NonNullable<unknown> }} Monitor_Check_ErrorInputs */
/**
* | reason | output |
* | --- | --- |
* | "timeout" | "Timed out" |
* | "network" | "Couldn't connect" |
* | "blocked" | "Address not allowed" |
* | "status" | "Got {got}, expected {expected}" |
* | "status_any" | "Got {got}, expected 2xx or 3xx" |
* | "keyword" | "Text not found" |
* | "missed" | "No ping in time" |
* | * | "Check failed" |
*
* @param {Monitor_Check_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_check_error: ((inputs: Monitor_Check_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Check_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
