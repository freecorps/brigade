export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_EditInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_EditInputs */
/**
* | part | output |
* | --- | --- |
* | "action" | "Edit" |
* | "form" | "Edit {name}" |
* | "restart" | "Saving starts its checks over: the last results are dropped and it shows Waiting until its regions report again." |
* | * | "Save changes" |
*
* @param {Monitor_EditInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_edit: ((inputs: Monitor_EditInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_EditInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
