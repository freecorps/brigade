export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Device_TokenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Device_TokenInputs */
/**
* | output |
* | --- |
* | "APNs device token" |
*
* @param {Push_Device_TokenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_device_token: ((inputs?: Push_Device_TokenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Device_TokenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
