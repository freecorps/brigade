export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_Open_IncidentsInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_Open_IncidentsInputs */
/**
* | output |
* | --- |
* | "Open incidents" |
*
* @param {Widget_Open_IncidentsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_open_incidents: ((inputs?: Widget_Open_IncidentsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_Open_IncidentsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
