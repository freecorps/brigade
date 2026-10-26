export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Limit_ReachedInputs = {
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ max: NonNullable<unknown> }} Monitor_Limit_ReachedInputs */
/**
* | output |
* | --- |
* | "This workspace has {max} monitors, the most it can have. Delete one to add another." |
*
* @param {Monitor_Limit_ReachedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_limit_reached: ((inputs: Monitor_Limit_ReachedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Limit_ReachedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
