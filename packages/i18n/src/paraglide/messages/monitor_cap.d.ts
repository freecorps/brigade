export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_CapInputs = {
    part: NonNullable<unknown>;
    count: NonNullable<unknown>;
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, count: NonNullable<unknown>, max: NonNullable<unknown> }} Monitor_CapInputs */
/**
* | part | output |
* | --- | --- |
* | "limit" | "Limit {max}" |
* | "edit" | "Change limit" |
* | "label" | "Monitor limit" |
* | "hint" | "At most {max} on this instance. Leave it empty to use that." |
* | "below" | "This workspace has {count} monitors already. They keep running, but no new one can be added until some are deleted." |
* | "invalid" | "Use a whole number from 1 to {max}, or leave it empty." |
* | "save" | "Save limit" |
* | * | "Monitor limit" |
*
* @param {Monitor_CapInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_cap: ((inputs: Monitor_CapInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_CapInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
