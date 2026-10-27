export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_NextInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Widget_NextInputs */
/**
* | output |
* | --- |
* | "Next shift {time}" |
*
* @param {Widget_NextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_next: ((inputs: Widget_NextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_NextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
