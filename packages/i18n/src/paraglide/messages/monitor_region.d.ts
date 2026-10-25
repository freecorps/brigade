export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_RegionInputs = {
    region: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ region: NonNullable<unknown> }} Monitor_RegionInputs */
/**
* | region | output |
* | --- | --- |
* | "wnam" | "US West" |
* | "enam" | "US East" |
* | "weur" | "Western Europe" |
* | "eeur" | "Eastern Europe" |
* | "apac" | "Asia-Pacific" |
* | * | "Oceania" |
*
* @param {Monitor_RegionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_region: ((inputs: Monitor_RegionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_RegionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
