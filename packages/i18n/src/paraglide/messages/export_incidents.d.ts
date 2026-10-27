export type LocalizedString = import('../runtime.js').LocalizedString;
export type Export_IncidentsInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Export_IncidentsInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} incident" |
* | * | "{countFormatted} incidents" |
*
* @param {Export_IncidentsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const export_incidents: ((inputs: Export_IncidentsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Export_IncidentsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
