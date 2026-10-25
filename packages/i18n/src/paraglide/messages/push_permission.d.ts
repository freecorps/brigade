export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_PermissionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_PermissionInputs */
/**
* | output |
* | --- |
* | "Notifications" |
*
* @param {Push_PermissionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_permission: ((inputs?: Push_PermissionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_PermissionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
