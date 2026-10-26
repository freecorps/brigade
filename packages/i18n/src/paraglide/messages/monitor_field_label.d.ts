export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Field_LabelInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_LabelInputs */
/**
* | field | output |
* | --- | --- |
* | "kind" | "Monitor type" |
* | "name" | "Name" |
* | "url" | "URL" |
* | "host" | "Host" |
* | "port" | "Port" |
* | "method" | "Method" |
* | "expected_status" | "Expected status" |
* | "keyword" | "Text the page must contain" |
* | "interval" | "Every (seconds)" |
* | "timeout" | "Timeout (seconds)" |
* | "grace" | "Grace (seconds)" |
* | * | "Check from" |
*
* @param {Monitor_Field_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_field_label: ((inputs: Monitor_Field_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
