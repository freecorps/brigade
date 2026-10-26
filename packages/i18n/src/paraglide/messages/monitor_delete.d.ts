export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_DeleteInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_DeleteInputs */
/**
* | part | output |
* | --- | --- |
* | "action" | "Delete monitor" |
* | "prompt" | "Delete {name}? Its checks stop and its results are gone for good." |
* | "alert" | "Its firing alert resolves. The incident it opened is left for people to close." |
* | "incidents" | "Incidents it opened before stay as they are." |
* | "heartbeat" | "Its heartbeat URL stops working." |
* | "keep" | "Keep monitor" |
* | * | "Delete" |
*
* @param {Monitor_DeleteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_delete: ((inputs: Monitor_DeleteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_DeleteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
