export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_On_Call_InInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Widget_On_Call_InInputs */
/**
* | output |
* | --- |
* | "On call in {name}" |
*
* @param {Widget_On_Call_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_on_call_in: ((inputs: Widget_On_Call_InInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_On_Call_InInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
