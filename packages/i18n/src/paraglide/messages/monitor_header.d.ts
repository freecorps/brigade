export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_HeaderInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_HeaderInputs */
/**
* | part | output |
* | --- | --- |
* | "add" | "Add header" |
* | "remove" | "Remove header {name}" |
* | "remove_unnamed" | "Remove this header" |
* | * | "Header" |
*
* @param {Monitor_HeaderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_header: ((inputs: Monitor_HeaderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_HeaderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
