export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Camera_UsageInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Mobile_Camera_UsageInputs */
/**
* | output |
* | --- |
* | "Brigade uses the camera to scan the QR code on your Brigade dashboard, to add an instance or sign you in." |
*
* @param {Mobile_Camera_UsageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_camera_usage: ((inputs?: Mobile_Camera_UsageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Camera_UsageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
