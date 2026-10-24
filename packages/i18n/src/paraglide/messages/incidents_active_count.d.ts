export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Active_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Incidents_Active_CountInputs */
/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No active incidents" |
* | * | "one" | "{countFormatted} active incident" |
* | * | * | "{countFormatted} active incidents" |
*
* @param {Incidents_Active_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_active_count: ((inputs: Incidents_Active_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Active_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
